#!/usr/bin/env node
// Generate the SNS caption set for review WITHOUT posting anything.
// Prints clean JSON to stdout (logs go to stderr). Used by the dashboard's
// "SNS文言プレビュー" so a human can check the text before going live.
//
//   node src/caption-preview.js --prompt "rainy night lofi" --channels youtube,x,instagram
//   node src/caption-preview.js --record recXXXX --channels youtube,x
import { parseArgs } from 'node:util';
import { config } from './config.js';
import { buildCaptions, assembleCaption } from './caption.js';
import { getChannel } from './sns.js';
import { AirtableStore } from './airtable.js';

const { values } = parseArgs({
  options: {
    record: { type: 'string' },
    prompt: { type: 'string' },
    title: { type: 'string' },
    tags: { type: 'string' },
    channels: { type: 'string' },
  },
});

async function buildTrack() {
  if (values.record) {
    const store = new AirtableStore(config.airtable, { dryRun: true });
    return await store.findShipment(values.record);
  }
  return {
    id: 'preview',
    title: values.title || 'Untitled',
    tags: values.tags || '',
    prompt: values.prompt || values.title || 'lo-fi beats',
  };
}

async function main() {
  const track = await buildTrack();
  const captions = await buildCaptions(track, config.prompt);

  const keys = (values.channels || 'youtube,x,instagram')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // A representative canonical link so text channels show where the URL goes.
  const canonicalUrl = config.sns.fallbackUrl || 'https://youtu.be/＜投稿後に確定＞';

  const channels = {};
  for (const key of keys) {
    const ch = getChannel(key);
    if (!ch) continue;
    const includeLink = key === 'x' ? config.sns.xIncludeLink : config.sns.textIncludeLink;
    const assembled = assembleCaption(ch, captions, { canonicalUrl, includeLink });
    channels[key] = {
      label: ch.label,
      captionStyle: ch.captionStyle,
      includeLink,
      title: assembled.title,
      body: assembled.body,
    };
  }

  process.stdout.write(
    JSON.stringify({
      via: captions.via,
      title: track.title,
      video: { title: captions.video.title, description: captions.video.body, hashtags: captions.video.hashtags },
      text: { body: captions.text.body },
      channels,
    })
  );
}

main().catch((err) => {
  process.stderr.write(`caption-preview error: ${err.message}\n`);
  process.exit(1);
});
