#!/usr/bin/env node
// One-time Airtable schema bootstrapper.
// Creates the target table (default "Tracks") with all columns lofi-studio
// writes to. Idempotent: if the table exists, only missing fields are added.
//
// Requires an Airtable PAT with scope `schema.bases:write` (in addition to
// data.records:read/write) and access to the target base.
import 'dotenv/config';
import { config, validateConfig } from './config.js';
import { FIELD_MAP } from './airtable.js';
import { fetchJson, withRetry } from './util.js';
import { log } from './logger.js';

// Desired schema: canonical column name -> Airtable field definition.
const SCHEMA = [
  { name: FIELD_MAP.title, type: 'singleLineText' }, // primary field (must be first)
  { name: FIELD_MAP.prompt, type: 'multilineText' },
  { name: FIELD_MAP.audioUrl, type: 'url' },
  { name: FIELD_MAP.streamUrl, type: 'url' },
  { name: FIELD_MAP.imageUrl, type: 'url' },
  { name: FIELD_MAP.tags, type: 'singleLineText' },
  { name: FIELD_MAP.model, type: 'singleLineText' },
  { name: FIELD_MAP.duration, type: 'number', options: { precision: 2 } },
  { name: FIELD_MAP.sunoId, type: 'singleLineText' },
  { name: FIELD_MAP.taskId, type: 'singleLineText' },
  {
    name: FIELD_MAP.generatedAt,
    type: 'dateTime',
    options: { timeZone: 'utc', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } },
  },
  { name: FIELD_MAP.status, type: 'singleLineText' },
  { name: FIELD_MAP.localPath, type: 'singleLineText' },
  { name: FIELD_MAP.audioAttachment, type: 'multipleAttachments' },
  // --- Phase 2: artwork & video ---
  { name: FIELD_MAP.artwork, type: 'multipleAttachments' },
  { name: FIELD_MAP.artworkUrl, type: 'url' },
  { name: FIELD_MAP.artworkPath, type: 'singleLineText' },
  { name: FIELD_MAP.videoPath, type: 'singleLineText' },
  { name: FIELD_MAP.videoUrl, type: 'url' },
  { name: FIELD_MAP.videoStatus, type: 'singleLineText' },
  // --- Phase 3: multi-SNS distribution ---
  { name: FIELD_MAP.postLog, type: 'multilineText' },
  {
    name: FIELD_MAP.shippedAt,
    type: 'dateTime',
    options: { timeZone: 'utc', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } },
  },
  { name: FIELD_MAP.youtubeUrl, type: 'url' },
  { name: FIELD_MAP.xUrl, type: 'url' },
  { name: FIELD_MAP.instagramUrl, type: 'url' },
  { name: FIELD_MAP.tiktokUrl, type: 'url' },
  { name: FIELD_MAP.threadsUrl, type: 'url' },
  { name: FIELD_MAP.redditUrl, type: 'url' },
  { name: FIELD_MAP.pinterestUrl, type: 'url' },
];

const META = 'https://api.airtable.com/v0/meta/bases';

async function main() {
  validateConfig();
  const { apiKey, baseId, tableName } = config.airtable;
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  log.info(`Inspecting base ${baseId} for table "${tableName}"...`);
  const list = await withRetry(
    () => fetchJson(`${META}/${baseId}/tables`, { headers }),
    { label: 'list tables' }
  );
  const existing = (list.tables || []).find((t) => t.name === tableName);

  if (!existing) {
    log.info(`Table "${tableName}" not found — creating it with ${SCHEMA.length} columns...`);
    const created = await withRetry(
      () =>
        fetchJson(`${META}/${baseId}/tables`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: tableName, fields: SCHEMA }),
        }),
      { label: 'create table' }
    );
    log.info(`✓ Created table "${created.name}" (id ${created.id}) with ${created.fields?.length ?? '?'} fields.`);
    return;
  }

  // Table exists: add any missing fields.
  log.info(`Table "${tableName}" already exists (id ${existing.id}). Checking columns...`);
  const have = new Set((existing.fields || []).map((f) => f.name));
  const missing = SCHEMA.filter((f) => !have.has(f.name));

  if (!missing.length) {
    log.info('✓ All required columns already present. Nothing to do.');
    return;
  }

  for (const field of missing) {
    // Can't add another primary-type via this endpoint, but our extras are safe.
    await withRetry(
      () =>
        fetchJson(`${META}/${baseId}/tables/${existing.id}/fields`, {
          method: 'POST',
          headers,
          body: JSON.stringify(field),
        }),
      { label: `add field ${field.name}` }
    );
    log.info(`  + added column "${field.name}" (${field.type})`);
  }
  log.info(`✓ Added ${missing.length} missing column(s) to "${tableName}".`);
}

main().catch((err) => {
  if (/schema\.bases:write|INVALID_PERMISSIONS/i.test(err.message || '')) {
    log.error(
      'Schema change failed. The Airtable token needs the `schema.bases:write` scope ' +
        '(plus access to the base) to create tables/fields.'
    );
  }
  log.error(err.message);
  process.exit(1);
});
