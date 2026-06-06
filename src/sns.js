// Multi-channel SNS posting registry — the core of the distribution system.
//
// Channels are plugins implementing the Channel contract (see channels/base.js).
// To add a new SNS: create channels/<name>.js, import it, and push it into
// CHANNELS below. Everything else (enable/disable, captioning, idempotent
// write-back, status flip) works unchanged.
import { Channel } from './channels/base.js';
import { mockChannel } from './channels/mock.js';
import { youtubeChannel } from './channels/youtube.js';
import { xChannel } from './channels/x.js';
import { pinterestChannel } from './channels/pinterest.js';

// --- Built-in channels ---------------------------------------------------
// `mock` is fully implemented. The rest are credential-gated SCAFFOLDS:
// they describe their requirements and stay inactive until both their
// ENABLE flag is on AND their credentials are present. Their post() throws
// until the real API code is added (so they never silently no-op).
const CHANNELS = [
  mockChannel,
  youtubeChannel, // real implementation (src/channels/youtube.js)

  new Channel({
    key: 'youtube_shorts',
    label: 'YouTube Shorts',
    mediaKind: 'vertical', // needs the (deferred) vertical short cut
    captionStyle: 'video',
    priority: 11,
    enableKey: 'YOUTUBE_SHORTS_ENABLE',
    requiredEnv: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
  }),

  new Channel({
    key: 'instagram',
    label: 'Instagram Reels',
    mediaKind: 'vertical', // Reels = 9:16, <=90s (deferred)
    captionStyle: 'video',
    priority: 20,
    enableKey: 'INSTAGRAM_ENABLE',
    requiredEnv: ['IG_ACCESS_TOKEN', 'IG_BUSINESS_ACCOUNT_ID'],
  }),

  new Channel({
    key: 'tiktok',
    label: 'TikTok',
    mediaKind: 'vertical',
    captionStyle: 'video',
    priority: 21,
    enableKey: 'TIKTOK_ENABLE',
    requiredEnv: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_ACCESS_TOKEN'],
  }),

  pinterestChannel, // real implementation (src/channels/pinterest.js)

  xChannel, // real implementation (src/channels/x.js)

  new Channel({
    key: 'threads',
    label: 'Threads',
    mediaKind: 'landscape',
    captionStyle: 'text',
    priority: 51,
    enableKey: 'THREADS_ENABLE',
    requiredEnv: ['THREADS_ACCESS_TOKEN', 'THREADS_USER_ID'],
  }),

  new Channel({
    key: 'reddit',
    label: 'Reddit',
    mediaKind: 'link', // submits a link post to the canonical URL
    captionStyle: 'text',
    priority: 52,
    enableKey: 'REDDIT_ENABLE',
    requiredEnv: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USERNAME', 'REDDIT_PASSWORD', 'REDDIT_SUBREDDIT'],
  }),
];

const registry = new Map(CHANNELS.map((c) => [c.key, c]));

export function registerChannel(channel) {
  registry.set(channel.key, channel);
}

export function allChannels() {
  return [...registry.values()];
}

export function getChannel(key) {
  return registry.get(key);
}

const parseList = (s) =>
  (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Resolve the channels to target this run, sorted by posting priority.
 * - An explicit allowlist (CLI `--channels` or env SNS_CHANNELS) acts as the
 *   enable switch: listed channels are targeted regardless of their ENABLE flag.
 * - With no allowlist, each channel's own ENABLE flag decides.
 */
export function resolveTargets(env, { only } = {}) {
  const allow = (only && only.length ? only : parseList(env.SNS_CHANNELS));
  let targets;
  if (allow.length) {
    targets = allChannels().filter((c) => allow.includes(c.key));
  } else {
    targets = allChannels().filter((c) => c.enabledFlag(env));
  }
  return targets.sort((a, b) => a.priority - b.priority);
}
