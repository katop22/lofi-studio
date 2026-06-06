// Generate two caption variants per track via Ollama, with template fallbacks:
//   - video : title + emotive description + many hashtags (YouTube/TikTok/IG/...)
//   - text  : one short emotive post, no hashtags, no link (X/Threads/Reddit/...)
// The link (if any) is appended per-channel by assembleCaption(), never here.
import { askOllama } from './prompt.js';
import { log } from './logger.js';

const FALLBACK_HASHTAGS = [
  'lofi', 'lofihiphop', 'lofibeats', 'studymusic', 'chillbeats', 'chillhop',
  'relaxingmusic', 'studywithme', 'focusmusic', 'lofivibes', 'beatstorelaxto', 'lofiradio',
];

const clean = (s) => (s || '').replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ').trim();
const hashtagify = (arr) =>
  arr
    .map((h) => '#' + String(h).replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter((h) => h.length > 1)
    .join(' ');

function templateVideo(track) {
  return {
    title: `${track.title} ☕ lofi beats to study/relax to`,
    body: `${track.title} — a cozy lo-fi loop to help you focus, study, and unwind.`,
    hashtags: hashtagify(FALLBACK_HASHTAGS),
  };
}

function templateText(track) {
  return `late-night loops and quiet thoughts. "${track.title}" is up — press play and breathe. 🎧`;
}

async function videoCaption(track, vibe, cfg) {
  const instruction =
    'You write metadata for a lo-fi music video (for studying/relaxing). ' +
    'Return ONLY JSON with keys: "title" (catchy, under 60 chars), ' +
    '"description" (1-2 emotive sentences, no hashtags, no links), ' +
    '"hashtags" (array of 10-14 short lowercase tags, no # symbol, relevant to lo-fi / study / chill / focus). ' +
    `Music vibe: ${vibe}\nTrack title: ${track.title || ''}`;
  const raw = await askOllama(cfg, instruction, { temperature: 0.8, format: 'json' });
  const obj = JSON.parse(raw);
  const tags = Array.isArray(obj.hashtags) && obj.hashtags.length ? obj.hashtags : FALLBACK_HASHTAGS;
  return {
    title: clean(obj.title) || track.title,
    body: clean(obj.description) || templateVideo(track).body,
    hashtags: hashtagify(tags),
  };
}

async function textCaption(track, vibe, cfg) {
  const instruction =
    'Write ONE short, emotional, aesthetic social-media post to share a lo-fi music track. ' +
    'Max 200 characters. No hashtags, no links, no surrounding quotes. Lowercase is fine. ' +
    `Output only the post text.\nMusic vibe: ${vibe}\nTrack title: ${track.title || ''}`;
  const raw = await askOllama(cfg, instruction, { temperature: 0.95 });
  return clean(raw).slice(0, 240);
}

/** Build { video:{title,body,hashtags}, text:{body}, via } for a track. */
export async function buildCaptions(track, cfg) {
  const vibe = (track.tags || track.prompt || track.title || '').slice(0, 600);
  let video;
  let text;
  let via = 'ollama';

  try {
    video = await videoCaption(track, vibe, cfg);
  } catch (err) {
    log.warn(`Ollama video caption failed (${err.message}); using template`);
    video = templateVideo(track);
    via = 'template-fallback';
  }
  try {
    text = { body: await textCaption(track, vibe, cfg) };
  } catch (err) {
    log.warn(`Ollama text caption failed (${err.message}); using template`);
    text = { body: templateText(track) };
    via = via === 'ollama' ? 'partial-fallback' : via;
  }

  log.info(`Captions (${via}) — title: "${video.title}"`);
  return { video, text, via };
}

/**
 * Assemble the final caption an individual channel should post.
 * Video channels get title + description + hashtags.
 * Text channels get the emotive post, with the canonical link appended only
 * when that channel is configured to include links (X defaults to no link).
 */
export function assembleCaption(channel, captions, { canonicalUrl, includeLink }) {
  if (channel.captionStyle === 'video') {
    return {
      title: captions.video.title,
      body: `${captions.video.body}\n\n${captions.video.hashtags}`,
    };
  }
  // text style
  let body = captions.text.body;
  if (includeLink && canonicalUrl) body += `\n${canonicalUrl}`;
  return { title: captions.video.title, body };
}
