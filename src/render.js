#!/usr/bin/env node
// lofi-studio — Phase 2 orchestrator.
// Turn Airtable tracks (audio + cover) into YouTube-ready videos, then write
// the artwork + video info back to Airtable.
import { parseArgs } from 'node:util';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { config, validateConfig } from './config.js';
import { AirtableStore, FIELD_MAP } from './airtable.js';
import ffmpegPath from 'ffmpeg-static';
import { getArtwork } from './image.js';
import { renderVideo } from './video.js';
import { downloadFile, sanitizeFilename, runProcess } from './util.js';
import { log } from './logger.js';

/** Transcode artwork to a small JPG suitable for an Airtable attachment (<5MB). */
async function transcodeToJpg(src) {
  const dst = src.replace(/\.[a-z0-9]+$/i, '') + '_thumb.jpg';
  await runProcess(ffmpegPath, ['-y', '-i', src, '-vf', 'scale=1280:-2', '-q:v', '4', dst]);
  return dst;
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      record: { type: 'string', short: 'r' }, // single record id
      limit: { type: 'string', short: 'l' }, // max records to process
      force: { type: 'boolean' }, // re-render even if already "Video Ready"
      static: { type: 'boolean' }, // disable Ken Burns motion
      'dry-run': { type: 'boolean' }, // render locally but don't write to Airtable
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  return values;
}

function printHelp() {
  console.log(`
lofi-studio — Phase 2: artwork + video render

Usage:
  npm run render -- [options]
  node src/render.js [options]

Options:
  -r, --record <recId>   Render one specific Airtable record
  -l, --limit <n>        Max records to process (default: all pending)
      --force            Re-render even records already marked "Video Ready"
      --static           Disable Ken Burns motion (static image)
      --dry-run          Render locally but do NOT write back to Airtable
  -h, --help             Show this help
`);
}

async function fileExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function processTrack(track, { store, videoCfg, dryRun }) {
  log.info(`--- ${track.title} (${track.recordId}) ---`);
  if (!track.audioUrl) throw new Error('No Audio URL on record');

  // Mark as rendering (best-effort).
  await store.updateRecord(track.recordId, { [FIELD_MAP.videoStatus]: 'Rendering' }).catch(() => {});

  // 1) Ensure local audio.
  const audioName = `${sanitizeFilename(track.title)}_${track.id}.mp3`;
  const audioPath = path.resolve(config.video.audioDir, audioName);
  if (await fileExists(audioPath)) {
    log.info(`Audio already local -> ${audioPath}`);
  } else {
    await downloadFile(track.audioUrl, config.video.audioDir, audioName);
    log.info(`Downloaded audio -> ${audioPath}`);
  }

  // 2) Artwork (Suno cover, or local Stable Diffusion via ComfyUI).
  const artwork = await getArtwork(track, {
    source: videoCfg.artworkSource,
    dir: videoCfg.artworkDir,
    comfyui: config.comfyui,
    prompt: config.prompt,
  });

  // 3) Render video.
  const outName = `${sanitizeFilename(track.title)}_${track.id}.mp4`;
  const outPath = path.resolve(videoCfg.dir, outName);
  const result = await renderVideo({
    imagePath: artwork.path,
    audioPath,
    outPath,
    durationSec: track.duration,
    cfg: videoCfg,
  });

  // 4) Write back to Airtable.
  const fields = {
    [FIELD_MAP.videoPath]: result.path,
    [FIELD_MAP.videoStatus]: 'Video Ready',
  };
  if (artwork.sourceUrl) {
    // Public URL (Suno cover): attach by URL.
    fields[FIELD_MAP.artworkUrl] = artwork.sourceUrl;
    fields[FIELD_MAP.artwork] = [{ url: artwork.sourceUrl, filename: `${track.title}.jpg` }];
  } else {
    // Local file (Stable Diffusion): record path; upload bytes below.
    fields[FIELD_MAP.artworkPath] = artwork.path;
    fields[FIELD_MAP.artwork] = []; // clear any prior attachment before re-upload (upload is append-only)
    fields[FIELD_MAP.artworkUrl] = ''; // local art has no public URL
  }
  await store.updateRecord(track.recordId, fields);

  if (!artwork.sourceUrl && !dryRun) {
    try {
      const jpg = await transcodeToJpg(artwork.path);
      await store.uploadAttachment(track.recordId, jpg, { filename: `${sanitizeFilename(track.title)}.jpg` });
      log.info('Uploaded artwork thumbnail to Airtable');
    } catch (err) {
      log.warn(`Artwork attachment upload failed (continuing): ${err.message}`);
    }
  }
  if (dryRun) log.info('(dry-run: Airtable not updated)');

  return { title: track.title, recordId: track.recordId, video: result.path, bytes: result.bytes };
}

async function main() {
  const args = parseCliArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const dryRun = Boolean(args['dry-run']);
  validateConfig({ requireSuno: false });

  const videoCfg = { ...config.video };
  if (args.static) videoCfg.kenBurns = false;

  const store = new AirtableStore(config.airtable, { dryRun });

  // Select records to process.
  let tracks;
  if (args.record) {
    tracks = [await store.findOne(args.record)];
  } else {
    const limit = args.limit ? parseInt(args.limit, 10) : 0;
    tracks = await store.listForVideo({ limit, force: Boolean(args.force) });
  }

  log.info(`Phase 2 render${dryRun ? ' (DRY RUN)' : ''}: ${tracks.length} track(s) to process` +
    ` | motion=${videoCfg.kenBurns ? 'Ken Burns' : 'static'}`);

  if (!tracks.length) {
    log.info('Nothing to render. (All caught up, or no matching records.)');
    return;
  }

  const results = [];
  for (const track of tracks) {
    try {
      results.push(await processTrack(track, { store, videoCfg, dryRun }));
    } catch (err) {
      log.error(`Failed "${track.title}": ${err.message}`);
      await store.updateRecord(track.recordId, { [FIELD_MAP.videoStatus]: 'Error' }).catch(() => {});
      results.push({ title: track.title, recordId: track.recordId, error: err.message });
    }
  }

  const ok = results.filter((r) => r.video);
  const failed = results.filter((r) => r.error);
  log.info('==================== SUMMARY ====================');
  log.info(`Rendered: ${ok.length}/${results.length} video(s)`);
  ok.forEach((r) => log.info(`  ✓ ${r.title} -> ${r.video} (${(r.bytes / 1e6).toFixed(2)} MB)`));
  failed.forEach((r) => log.error(`  ✗ ${r.title}: ${r.error}`));
  log.info('================================================');

  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exit(1);
});
