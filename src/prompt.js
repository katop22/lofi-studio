// Turn a track's musical vibe into a vivid lo-fi anime image prompt.
// Primary path: a local Ollama LLM. Fallback: a deterministic template.
import { log } from './logger.js';

// Style scaffolding wrapped around whatever scene we get (LLM or template).
// Tuned for Animagine-XL-style SDXL with a Studio-Ghibli-inspired mood.
const STYLE_SUFFIX =
  'lo-fi aesthetic, studio ghibli inspired, hand-painted anime, soft warm lighting, ' +
  'nostalgic cozy atmosphere, detailed painterly background, cinematic, ' +
  'masterpiece, best quality, very aesthetic, absurdres';

const NEGATIVE =
  'lowres, worst quality, low quality, bad anatomy, bad hands, missing fingers, ' +
  'extra digits, text, error, signature, watermark, username, logo, jpeg artifacts, ' +
  'blurry, deformed, ugly, oversaturated, frame, border, nsfw, looking at viewer';

// Mood keywords we look for in Suno tags to seed the template fallback.
const MOOD_HINTS = [
  ['rain', 'rainy window with droplets, overcast soft light'],
  ['night', 'night time, city lights glowing in the distance'],
  ['study', 'a cozy desk with books and a warm lamp'],
  ['sunset', 'golden hour sunset, warm orange sky'],
  ['sunrise', 'soft morning light, pastel dawn sky'],
  ['cafe', 'a quiet cafe interior, steam rising from a cup'],
  ['winter', 'snow falling outside the window, warm interior'],
  ['summer', 'warm breeze, green plants by the window'],
  ['dream', 'dreamy hazy atmosphere, soft bokeh'],
  ['jazz', 'a dim room with a record player and vinyl'],
  ['ocean', 'a window overlooking a calm sea at dusk'],
  ['forest', 'a wooden cabin surrounded by misty trees'],
];

function randomSeed() {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

/** Deterministic-ish scene from tags when the LLM is unavailable. */
function templateScene(track) {
  const hay = `${track.tags || ''} ${track.title || ''}`.toLowerCase();
  const hits = MOOD_HINTS.filter(([k]) => hay.includes(k)).map(([, v]) => v);
  const base = 'a lone girl with headphones relaxing by a large window, plants, warm interior';
  const scene = hits.length ? `${base}, ${hits.slice(0, 3).join(', ')}` : `${base}, rainy window, evening city glow`;
  return scene;
}

/**
 * Generic local-Ollama text call. Shared by image-prompt and caption builders.
 * @param cfg  { ollamaUrl, ollamaModel, timeoutMs }
 * @param opts { temperature, format }  format:'json' forces JSON output
 */
export async function askOllama(cfg, prompt, { temperature = 0.8, format } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 60000);
  try {
    const body = { model: cfg.ollamaModel, prompt, stream: false, options: { temperature } };
    if (format) body.format = format;
    const res = await fetch(`${cfg.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const text = (data.response || '').trim();
    if (!text) throw new Error('empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the local Ollama model to translate the music vibe into a scene. */
async function ollamaScene(track, cfg) {
  const vibe = (track.tags || track.prompt || track.title || '').slice(0, 600);
  const instruction =
    'You are an art director creating cover art for lo-fi study music in a nostalgic, ' +
    'Studio Ghibli-inspired anime style. Given the musical vibe below, write ONE concise ' +
    'image-generation prompt: comma-separated visual phrases only (no full sentences), ' +
    'max 40 words, describing a single cozy scene (setting, time of day, lighting, color ' +
    'palette, small details). Do NOT mention music, audio, instruments, sound, text, or ' +
    'watermarks. Output ONLY the prompt, no preamble.\n\n' +
    `Musical vibe: ${vibe}\nTitle: ${track.title || ''}`;

  const raw = await askOllama(cfg, instruction, { temperature: 0.9 });
  // Sanitize: collapse to a single line, strip quotes/markdown/labels.
  const text = raw
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(prompt|scene)\s*[:\-]\s*/i, '')
    .replace(/\s*\n+\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) throw new Error('empty response');
  return text;
}

/**
 * Build { positive, negative, seed, scene, via } for a track.
 */
export async function buildImagePrompt(track, cfg) {
  let scene;
  let via = cfg.mode;
  if (cfg.mode === 'ollama') {
    try {
      scene = await ollamaScene(track, cfg);
      log.info(`Ollama scene: ${scene}`);
    } catch (err) {
      log.warn(`Ollama prompt failed (${err.message}); falling back to template`);
      scene = templateScene(track);
      via = 'template-fallback';
    }
  } else {
    scene = templateScene(track);
  }

  return {
    positive: `${scene}, ${STYLE_SUFFIX}`,
    negative: NEGATIVE,
    seed: randomSeed(),
    scene,
    via,
  };
}
