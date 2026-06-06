// Loads and validates configuration from environment (.env).
import 'dotenv/config';
import { log } from './logger.js';

const bool = (v, def = false) => {
  if (v === undefined || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
};
const int = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};
const num = (v, def) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
};

export const config = {
  suno: {
    apiKey: process.env.SUNO_API_KEY || '',
    baseUrl: (process.env.SUNO_API_BASE_URL || 'https://api.sunoapi.org').replace(/\/+$/, ''),
    model: process.env.SUNO_MODEL || 'V4_5',
    instrumental: bool(process.env.SUNO_INSTRUMENTAL, true),
    customMode: bool(process.env.SUNO_CUSTOM_MODE, false),
    callbackUrl: process.env.SUNO_CALLBACK_URL || '',
    pollIntervalMs: int(process.env.SUNO_POLL_INTERVAL_MS, 8000),
    pollTimeoutMs: int(process.env.SUNO_POLL_TIMEOUT_MS, 600000),
  },
  airtable: {
    apiKey: process.env.AIRTABLE_API_KEY || '',
    baseId: process.env.AIRTABLE_BASE_ID || '',
    tableName: process.env.AIRTABLE_TABLE_NAME || 'Tracks',
    attachAudio: bool(process.env.AIRTABLE_ATTACH_AUDIO, true),
  },
  output: {
    download: bool(process.env.DOWNLOAD_AUDIO, true),
    dir: process.env.OUTPUT_DIR || './output',
  },
  sns: {
    channels: process.env.SNS_CHANNELS || '', // allowlist (comma); empty => use per-channel ENABLE flags
    xIncludeLink: bool(process.env.SNS_X_INCLUDE_LINK, false), // X links cost ~$0.20/post -> off by default
    textIncludeLink: bool(process.env.SNS_TEXT_INCLUDE_LINK, true),
    fallbackUrl: process.env.SNS_FALLBACK_URL || '', // canonical link if no video channel has posted yet
  },
  prompt: {
    mode: process.env.PROMPT_MODE || 'ollama', // ollama | template
    ollamaUrl: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, ''),
    ollamaModel: process.env.OLLAMA_MODEL || 'dolphin-llama3:latest',
    timeoutMs: int(process.env.OLLAMA_TIMEOUT_MS, 60000),
  },
  comfyui: {
    url: (process.env.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/+$/, ''),
    checkpoint: process.env.SD_CHECKPOINT || 'animagine-xl-4.0.safetensors',
    baseWidth: int(process.env.SD_BASE_WIDTH, 1344),
    baseHeight: int(process.env.SD_BASE_HEIGHT, 768),
    width: int(process.env.SD_WIDTH, 1920),
    height: int(process.env.SD_HEIGHT, 1080),
    steps: int(process.env.SD_STEPS, 28),
    hiresSteps: int(process.env.SD_HIRES_STEPS, 14),
    cfg: num(process.env.SD_CFG, 6),
    sampler: process.env.SD_SAMPLER || 'euler_ancestral',
    scheduler: process.env.SD_SCHEDULER || 'normal',
    hiresDenoise: num(process.env.SD_HIRES_DENOISE, 0.45),
    timeoutMs: int(process.env.SD_TIMEOUT_MS, 300000),
  },
  video: {
    artworkSource: process.env.ARTWORK_SOURCE || 'suno-cover',
    artworkDir: process.env.ARTWORK_DIR || './output/artwork',
    audioDir: process.env.VIDEO_AUDIO_DIR || './output/audio',
    dir: process.env.VIDEO_OUTPUT_DIR || './output/video',
    width: int(process.env.VIDEO_WIDTH, 1920),
    height: int(process.env.VIDEO_HEIGHT, 1080),
    fps: int(process.env.VIDEO_FPS, 30),
    kenBurns: bool(process.env.VIDEO_KEN_BURNS, true),
    zoomMax: num(process.env.VIDEO_ZOOM_MAX, 1.12),
    crf: int(process.env.VIDEO_CRF, 20),
    preset: process.env.VIDEO_PRESET || 'medium',
    audioBitrate: process.env.VIDEO_AUDIO_BITRATE || '192k',
  },
  defaultPrompt: process.env.DEFAULT_PROMPT || 'Chilled Lo-Fi Beats for studying',
};

/**
 * Validate required configuration. In dry-run mode, missing credentials are
 * downgraded to warnings so the full pipeline can still be exercised offline.
 */
export function validateConfig({ dryRun = false, requireSuno = true } = {}) {
  const missing = [];
  if (requireSuno && !config.suno.apiKey) missing.push('SUNO_API_KEY');
  if (!config.airtable.apiKey) missing.push('AIRTABLE_API_KEY');
  if (!config.airtable.baseId) missing.push('AIRTABLE_BASE_ID');

  if (missing.length) {
    const msg = `Missing required environment variables: ${missing.join(', ')}`;
    if (dryRun) {
      log.warn(`${msg} (ignored in --dry-run mode)`);
    } else {
      throw new Error(`${msg}. Copy .env.example to .env and fill in the values.`);
    }
  }
  return config;
}
