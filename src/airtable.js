// Airtable storage: append generated-track records to a table.
import fsp from 'node:fs/promises';
import path from 'node:path';
import Airtable from 'airtable';
import { log } from './logger.js';

// Canonical track field -> Airtable column name.
// Adjust the right-hand values to match your table, or rename columns in Airtable.
export const FIELD_MAP = {
  title: 'Title',
  prompt: 'Prompt',
  audioUrl: 'Audio URL',
  streamUrl: 'Stream URL',
  imageUrl: 'Image URL',
  tags: 'Tags',
  model: 'Model',
  duration: 'Duration',
  sunoId: 'Suno ID',
  taskId: 'Task ID',
  generatedAt: 'Generated At',
  status: 'Status',
  audioAttachment: 'Audio', // attachment-type column (optional)
  localPath: 'Local Path',
  // --- Phase 2: artwork & video ---
  artwork: 'Artwork', // attachment-type column
  artworkUrl: 'Artwork URL',
  artworkPath: 'Artwork Path',
  videoPath: 'Video Path',
  videoUrl: 'Video URL',
  videoStatus: 'Video Status', // Pending -> Rendering -> Video Ready -> Uploaded
  // --- Phase 3: multi-SNS distribution ---
  postLog: 'Post Log', // JSON: { <channel>: { url, id, at } } — idempotency source of truth
  shippedAt: 'Shipped At',
  youtubeUrl: 'YouTube URL',
  xUrl: 'X URL',
  instagramUrl: 'Instagram URL',
  tiktokUrl: 'TikTok URL',
  threadsUrl: 'Threads URL',
  redditUrl: 'Reddit URL',
  pinterestUrl: 'Pinterest URL',
};

// Per-channel convenience URL columns (channels without an entry only write Post Log).
export const CHANNEL_URL_FIELD = {
  youtube: FIELD_MAP.youtubeUrl,
  x: FIELD_MAP.xUrl,
  instagram: FIELD_MAP.instagramUrl,
  tiktok: FIELD_MAP.tiktokUrl,
  threads: FIELD_MAP.threadsUrl,
  reddit: FIELD_MAP.redditUrl,
  pinterest: FIELD_MAP.pinterestUrl,
};

export class AirtableStore {
  constructor(cfg, { dryRun = false } = {}) {
    this.cfg = cfg;
    this.dryRun = dryRun;
    // Construct the base whenever credentials exist (no network call here).
    // `dryRun` only gates writes, so reads still work in dry-run render mode.
    if (cfg.apiKey && cfg.baseId) {
      this.base = new Airtable({ apiKey: cfg.apiKey }).base(cfg.baseId);
    }
  }

  /** Map an Airtable record into the canonical track shape used downstream. */
  recordToTrack(rec) {
    const f = rec.fields || {};
    return {
      recordId: rec.id,
      id: f[FIELD_MAP.sunoId] || rec.id,
      title: f[FIELD_MAP.title] || 'Untitled',
      audioUrl: f[FIELD_MAP.audioUrl] || '',
      imageUrl: f[FIELD_MAP.imageUrl] || '',
      duration: typeof f[FIELD_MAP.duration] === 'number' ? f[FIELD_MAP.duration] : null,
      videoStatus: f[FIELD_MAP.videoStatus] || '',
    };
  }

  /** Fetch a single record by id as a track. */
  async findOne(recordId) {
    const rec = await this.base(this.cfg.tableName).find(recordId);
    return this.recordToTrack(rec);
  }

  /** Map an Airtable record into the shape the shipping pipeline needs. */
  recordToShipment(rec) {
    const f = rec.fields || {};
    let postLog = {};
    try {
      postLog = f[FIELD_MAP.postLog] ? JSON.parse(f[FIELD_MAP.postLog]) : {};
    } catch {
      postLog = {};
    }
    return {
      recordId: rec.id,
      id: f[FIELD_MAP.sunoId] || rec.id,
      title: f[FIELD_MAP.title] || 'Untitled',
      tags: f[FIELD_MAP.tags] || '',
      prompt: f[FIELD_MAP.prompt] || '',
      videoPath: f[FIELD_MAP.videoPath] || '',
      videoStatus: f[FIELD_MAP.videoStatus] || '',
      // Artwork URLs for image-based channels (Pinterest, etc.)
      artworkUrl: f[FIELD_MAP.artworkUrl] || '',
      imageUrl: f[FIELD_MAP.imageUrl] || '',
      postLog,
    };
  }

  /** Fetch one record as a shipment. */
  async findShipment(recordId) {
    const rec = await this.base(this.cfg.tableName).find(recordId);
    return this.recordToShipment(rec);
  }

  /** List shipments ready to distribute (video rendered, not yet fully Uploaded). */
  async listForShipping({ limit = 0, force = false } = {}) {
    const conds = [`{${FIELD_MAP.videoPath}}!=''`];
    if (!force) {
      conds.push(`{${FIELD_MAP.videoStatus}}='Video Ready'`);
    } else {
      conds.push(`OR({${FIELD_MAP.videoStatus}}='Video Ready', {${FIELD_MAP.videoStatus}}='Uploaded')`);
    }
    const opts = { filterByFormula: `AND(${conds.join(',')})` };
    if (limit > 0) opts.maxRecords = limit;
    const recs = await this.base(this.cfg.tableName).select(opts).all();
    return recs.map((r) => this.recordToShipment(r));
  }

  /** List tracks that still need a video (have audio, not yet "Video Ready"). */
  async listForVideo({ limit = 0, force = false } = {}) {
    const conds = [`{${FIELD_MAP.audioUrl}}!=''`];
    if (!force) {
      conds.push(
        `OR({${FIELD_MAP.videoStatus}}='', {${FIELD_MAP.videoStatus}}='Pending', {${FIELD_MAP.videoStatus}}='Rendering', {${FIELD_MAP.videoStatus}}='Error')`
      );
    }
    const opts = { filterByFormula: conds.length > 1 ? `AND(${conds.join(',')})` : conds[0] };
    if (limit > 0) opts.maxRecords = limit;
    const recs = await this.base(this.cfg.tableName).select(opts).all();
    return recs.map((r) => this.recordToTrack(r));
  }

  /**
   * Upload a local file as an attachment to an attachment field on a record,
   * via Airtable's content-upload API (base64, max 5MB). Used for locally
   * generated artwork that has no public URL.
   */
  async uploadAttachment(recordId, filePath, { fieldName = FIELD_MAP.artwork, contentType = 'image/jpeg', filename } = {}) {
    if (this.dryRun) {
      log.info(`[dry-run] Would upload attachment ${filePath} -> ${recordId}.${fieldName}`);
      return null;
    }
    const data = await fsp.readFile(filePath);
    if (data.length > 5 * 1024 * 1024) {
      throw new Error(`Attachment ${filePath} is ${(data.length / 1e6).toFixed(1)}MB (>5MB Airtable limit)`);
    }
    const url = `https://content.airtable.com/v0/${this.cfg.baseId}/${recordId}/${encodeURIComponent(fieldName)}/uploadAttachment`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentType,
        file: data.toString('base64'),
        filename: filename || path.basename(filePath),
      }),
    });
    if (!res.ok) {
      throw new Error(`Airtable uploadAttachment failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    return res.json();
  }

  /** Update arbitrary fields on a record (no-op write in dry-run). */
  async updateRecord(id, fields) {
    if (this.dryRun) {
      log.info(`[dry-run] Would update ${id}: ${JSON.stringify(fields)}`);
      return { id, fields };
    }
    const recs = await this.base(this.cfg.tableName).update([{ id, fields }], { typecast: true });
    return { id: recs[0].id, fields: recs[0].fields };
  }

  /** Build an Airtable `fields` object from a normalized track. */
  buildFields(track, { taskId, localPath } = {}) {
    const f = {};
    f[FIELD_MAP.title] = track.title;
    f[FIELD_MAP.prompt] = track.prompt || '';
    f[FIELD_MAP.audioUrl] = track.audioUrl || '';
    f[FIELD_MAP.streamUrl] = track.streamAudioUrl || '';
    f[FIELD_MAP.imageUrl] = track.imageUrl || '';
    f[FIELD_MAP.tags] = track.tags || '';
    f[FIELD_MAP.model] = track.modelName || this.cfg?.model || '';
    if (track.duration != null) f[FIELD_MAP.duration] = track.duration;
    f[FIELD_MAP.sunoId] = track.id || '';
    if (taskId) f[FIELD_MAP.taskId] = taskId;
    f[FIELD_MAP.generatedAt] = track.createTime || new Date().toISOString();
    f[FIELD_MAP.status] = 'Generated';
    f[FIELD_MAP.videoStatus] = 'Pending'; // queue for Phase 2 video rendering
    if (localPath) f[FIELD_MAP.localPath] = localPath;
    if (this.cfg.attachAudio && track.audioUrl) {
      f[FIELD_MAP.audioAttachment] = [{ url: track.audioUrl, filename: `${track.title}.mp3` }];
    }
    return f;
  }

  /** Create one record. Returns { id, fields } or a mock object in dry-run. */
  async createTrackRecord(track, meta = {}) {
    const fields = this.buildFields(track, meta);

    if (this.dryRun) {
      log.info('[dry-run] Would create Airtable record:');
      log.info(JSON.stringify(fields, null, 2));
      return { id: `recMOCK_${Math.abs(hashCode(track.id || track.title))}`, fields };
    }

    try {
      const records = await this.base(this.cfg.tableName).create([{ fields }], { typecast: true });
      const rec = records[0];
      log.info(`Created Airtable record ${rec.id} for "${track.title}"`);
      return { id: rec.id, fields: rec.fields };
    } catch (err) {
      // Surface schema mismatches with actionable guidance.
      if (/UNKNOWN_FIELD_NAME|NOT_FOUND|INVALID_/i.test(err.message || '')) {
        log.error(
          'Airtable rejected the record. Ensure your table has these columns ' +
            `(or edit FIELD_MAP in src/airtable.js): ${Object.values(FIELD_MAP).join(', ')}`
        );
      }
      throw new Error(`Airtable create failed: ${err.message}`);
    }
  }
}

// Deterministic small hash (used only for mock record IDs).
function hashCode(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}
