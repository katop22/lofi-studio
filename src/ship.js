#!/usr/bin/env node
// lofi-studio — Phase 3 orchestrator: distribute rendered videos to many SNS.
//
// For each "Video Ready" record: generate captions (Ollama), then post to every
// active channel in priority order. Each success is written back to Airtable
// immediately (Post Log JSON + per-channel URL column). When every targeted
// channel has succeeded, Video Status flips to "Uploaded". Re-runs are
// idempotent: already-posted channels are skipped, only the missing ones retry.
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import { config, validateConfig } from './config.js';
import { AirtableStore, FIELD_MAP, CHANNEL_URL_FIELD } from './airtable.js';
import { resolveTargets, allChannels } from './sns.js';
import { buildCaptions, assembleCaption } from './caption.js';
import { log } from './logger.js';

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      record: { type: 'string', short: 'r' },
      limit: { type: 'string', short: 'l' },
      channels: { type: 'string' }, // comma list override (acts as enable)
      force: { type: 'boolean' }, // re-post already-shipped channels
      'dry-run': { type: 'boolean' }, // do everything except write to Airtable
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  return values;
}

function printHelp() {
  console.log(`
lofi-studio — Phase 3: multi-SNS distribution

Usage:
  npm run ship -- [options]
  node src/ship.js [options]

Options:
  -r, --record <recId>   Ship one specific Airtable record
  -l, --limit <n>        Max records to process (default: all Video Ready)
      --channels <list>  Comma list to target this run (e.g. mock  or  youtube,x)
      --force            Re-post channels already recorded in Post Log
      --dry-run          Run captions + posting but do NOT write to Airtable
  -h, --help             Show this help

Active channels come from --channels, else SNS_CHANNELS, else each channel's
<NAME>_ENABLE flag. A channel posts only when it is also fully configured.
`);
}

const nowIso = () => new Date().toISOString();

/** Decide whether a channel's required media is available this phase. */
function mediaAvailable(channel, ctx) {
  switch (channel.mediaKind) {
    case 'landscape':
      return ctx.media.videoPath && fs.existsSync(ctx.media.videoPath)
        ? { ok: true }
        : { ok: false, reason: 'landscape video file missing on disk' };
    case 'vertical':
      return { ok: false, reason: 'vertical short-form media not produced yet (deferred)' };
    case 'link':
      return ctx.canonicalUrl
        ? { ok: true }
        : { ok: false, reason: 'no canonical URL yet (post a video channel first or set SNS_FALLBACK_URL)' };
    case 'text':
    case 'none':
      return { ok: true }; // text-only post needs no media (e.g. X)
    default:
      return { ok: true };
  }
}

async function shipRecord(shipment, { store, targets, dryRun }) {
  log.info(`=== ${shipment.title} (${shipment.recordId}) ===`);
  const postLog = { ...shipment.postLog };

  const captions = await buildCaptions(shipment, config.prompt);
  // Surface the generated SNS text so a human can review it in the log.
  log.info(`  [文言/動画] タイトル: ${captions.video.title}`);
  log.info(`  [文言/動画] 概要欄: ${captions.video.body}`);
  log.info(`  [文言/動画] ハッシュタグ: ${captions.video.hashtags}`);
  log.info(`  [文言/テキスト] 本文: ${captions.text.body}`);

  // Seed canonical URL from config fallback or any prior canonical-channel post.
  // Scans ALL channels (not just this run's targets) so partial re-runs pick up
  // an existing YouTube URL even when --channels excludes youtube.
  let canonicalUrl = config.sns.fallbackUrl || '';
  for (const c of allChannels()) {
    if (c.providesCanonicalUrl && postLog[c.key]?.url) canonicalUrl = postLog[c.key].url;
  }

  const outcome = {}; // key -> 'posted' | 'skipped' | 'blocked: ...' | 'failed: ...'

  for (const channel of targets) {
    // Idempotency: skip channels already shipped (unless --force).
    if (postLog[channel.key]?.url && !config._force) {
      outcome[channel.key] = 'skipped (already posted)';
      if (channel.providesCanonicalUrl) canonicalUrl = postLog[channel.key].url;
      continue;
    }

    // Configuration / wiring checks.
    const missing = channel.missingCreds(process.env);
    if (missing.length) {
      outcome[channel.key] = `blocked: missing creds (${missing.join(', ')})`;
      continue;
    }

    const media = { videoPath: shipment.videoPath };
    const ctx = { track: shipment, media, canonicalUrl, channel, env: process.env };
    const avail = mediaAvailable(channel, ctx);
    if (!avail.ok) {
      outcome[channel.key] = `blocked: ${avail.reason}`;
      continue;
    }

    // Caption (video vs text; X omits link by default).
    const includeLink = channel.key === 'x' ? config.sns.xIncludeLink : config.sns.textIncludeLink;
    ctx.caption = assembleCaption(channel, captions, { canonicalUrl, includeLink });
    log.info(`  [${channel.key}] 投稿文言: ${(ctx.caption.body || '').replace(/\n+/g, ' / ')}`);

    try {
      const res = await channel.post(ctx);
      if (!res?.url) throw new Error('channel returned no url');
      postLog[channel.key] = { url: res.url, id: res.id || null, at: nowIso() };
      if (channel.providesCanonicalUrl && res.url) canonicalUrl = res.url;

      // Write back immediately (per "順次" requirement).
      const fields = { [FIELD_MAP.postLog]: JSON.stringify(postLog, null, 2) };
      if (CHANNEL_URL_FIELD[channel.key]) fields[CHANNEL_URL_FIELD[channel.key]] = res.url;
      await store.updateRecord(shipment.recordId, fields);

      outcome[channel.key] = `posted -> ${res.url}`;
      log.info(`  ✓ ${channel.label}: ${res.url}`);
    } catch (err) {
      outcome[channel.key] = `failed: ${err.message}`;
      log.error(`  ✗ ${channel.label}: ${err.message}`);
    }
  }

  // Completion: every targeted channel has a recorded success.
  const allDone = targets.length > 0 && targets.every((c) => postLog[c.key]?.url);
  if (allDone) {
    await store.updateRecord(shipment.recordId, {
      [FIELD_MAP.videoStatus]: 'Uploaded',
      [FIELD_MAP.shippedAt]: nowIso(),
    });
    log.info(`  → Video Status set to "Uploaded" (all ${targets.length} channel(s) done)`);
  } else {
    log.info('  → Partial: Video Status stays "Video Ready" (re-run to finish remaining channels)');
  }

  return { title: shipment.title, recordId: shipment.recordId, allDone, outcome };
}

async function main() {
  const args = parseCliArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const dryRun = Boolean(args['dry-run']);
  config._force = Boolean(args.force);
  validateConfig({ requireSuno: false });

  const only = args.channels ? args.channels.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const targets = resolveTargets(process.env, { only });

  if (!targets.length) {
    log.warn('No active channels. Enable some via --channels, SNS_CHANNELS, or <NAME>_ENABLE flags.');
    return;
  }
  log.info(`Active channels (${targets.length}): ${targets.map((c) => c.key).join(', ')}`);

  const store = new AirtableStore(config.airtable, { dryRun });

  let shipments;
  if (args.record) {
    shipments = [await store.findShipment(args.record)];
  } else {
    const limit = args.limit ? parseInt(args.limit, 10) : 0;
    shipments = await store.listForShipping({ limit, force: config._force });
  }

  log.info(`Phase 3 ship${dryRun ? ' (DRY RUN)' : ''}: ${shipments.length} record(s)`);
  if (!shipments.length) {
    log.info('Nothing to ship. (No "Video Ready" records, or all already Uploaded.)');
    return;
  }

  const results = [];
  for (const s of shipments) {
    try {
      results.push(await shipRecord(s, { store, targets, dryRun }));
    } catch (err) {
      log.error(`Failed "${s.title}": ${err.message}`);
      results.push({ title: s.title, recordId: s.recordId, error: err.message });
    }
  }

  // Summary
  log.info('==================== SUMMARY ====================');
  for (const r of results) {
    if (r.error) {
      log.error(`✗ ${r.title}: ${r.error}`);
      continue;
    }
    log.info(`${r.allDone ? '✓ Uploaded' : '◐ Partial'} — ${r.title}`);
    for (const [k, v] of Object.entries(r.outcome)) log.info(`    ${k}: ${v}`);
  }
  log.info('================================================');

  const anyFailedOrBlocked = results.some(
    (r) => r.error || (r.outcome && Object.values(r.outcome).some((v) => /^(failed|blocked)/.test(v)))
  );
  if (anyFailedOrBlocked) process.exitCode = 1;
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exit(1);
});
