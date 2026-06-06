#!/usr/bin/env node
// lofi-studio — Phase 1 orchestrator.
// Generate Lo-Fi music with Suno, then store each track in Airtable.
import { parseArgs } from 'node:util';
import { config, validateConfig } from './config.js';
import { SunoClient } from './suno.js';
import { AirtableStore } from './airtable.js';
import { downloadFile, sanitizeFilename } from './util.js';
import { log } from './logger.js';

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      prompt: { type: 'string', short: 'p' },
      title: { type: 'string', short: 't' },
      model: { type: 'string', short: 'm' },
      task: { type: 'string' },
      instrumental: { type: 'boolean' },
      'no-instrumental': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'no-download': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  return values;
}

function printHelp() {
  console.log(`
lofi-studio — Suno -> Airtable pipeline

Usage:
  npm run generate -- [options]
  node src/index.js [options]

Options:
  -p, --prompt <text>     Music prompt (default: DEFAULT_PROMPT from .env)
  -t, --title <text>      Title (used in custom mode / file naming)
  -m, --model <name>      Override Suno model (e.g. V4_5, V5)
      --task <taskId>     Re-store an EXISTING Suno task into Airtable
                          (skips generation — no Suno credits used)
      --instrumental      Force instrumental
      --no-instrumental   Force vocals
      --no-download       Skip downloading the audio binary locally
      --dry-run           Run the full pipeline with mocked Suno + Airtable
  -h, --help              Show this help
`);
}

async function main() {
  const args = parseCliArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const dryRun = Boolean(args['dry-run']);
  validateConfig({ dryRun });

  const prompt = args.prompt || config.defaultPrompt;
  const instrumental = args['no-instrumental']
    ? false
    : args.instrumental
      ? true
      : config.suno.instrumental;

  const restoreTaskId = args.task;
  log.info(`Starting lofi-studio${dryRun ? ' (DRY RUN)' : ''}${restoreTaskId ? ' (RE-STORE MODE)' : ''}`);

  const suno = new SunoClient(config.suno, { mock: dryRun });
  const store = new AirtableStore(config.airtable, { dryRun });

  // 1) Obtain tracks — either from an existing task (re-store) or a new generation.
  let taskId;
  let tracks;
  if (restoreTaskId) {
    log.info(`Re-store mode: fetching existing task ${restoreTaskId} (no generation, no Suno credits used)`);
    taskId = restoreTaskId;
    tracks = await suno.waitForCompletion(taskId);
    log.info(`Fetched ${tracks.length} track(s) from existing task ${taskId}`);
  } else {
    log.info(`Prompt: "${prompt}" | instrumental=${instrumental} | model=${args.model || config.suno.model}`);
    ({ taskId, tracks } = await suno.generate({
      prompt,
      instrumental,
      model: args.model,
      title: args.title,
    }));
    log.info(`Generation complete: ${tracks.length} track(s) from task ${taskId}`);
  }

  // 2) Per-track: download (optional) + store in Airtable
  const results = [];
  // In re-store mode the audio is already on disk — skip re-downloading.
  const wantDownload = config.output.download && !args['no-download'] && !restoreTaskId;

  for (const track of tracks) {
    let localPath;
    if (wantDownload && track.audioUrl && !dryRun) {
      try {
        const filename = `${sanitizeFilename(track.title)}_${track.id || 'track'}.mp3`;
        localPath = await downloadFile(track.audioUrl, config.output.dir, filename);
        log.info(`Downloaded audio -> ${localPath}`);
      } catch (err) {
        log.warn(`Audio download failed (continuing): ${err.message}`);
      }
    }

    try {
      const rec = await store.createTrackRecord(track, { taskId, localPath });
      results.push({ track: track.title, recordId: rec.id, localPath });
    } catch (err) {
      log.error(`Failed to store "${track.title}": ${err.message}`);
      results.push({ track: track.title, error: err.message });
    }
  }

  // 3) Report
  const ok = results.filter((r) => r.recordId);
  const failed = results.filter((r) => r.error);
  log.info('==================== SUMMARY ====================');
  log.info(`Task: ${taskId}`);
  log.info(`Stored: ${ok.length}/${results.length} track(s)`);
  ok.forEach((r) => log.info(`  ✓ ${r.track} -> ${r.recordId}${r.localPath ? ` (${r.localPath})` : ''}`));
  failed.forEach((r) => log.error(`  ✗ ${r.track}: ${r.error}`));
  log.info('================================================');

  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exit(1);
});
