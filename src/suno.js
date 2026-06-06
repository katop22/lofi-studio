// Suno AI client: submit a generation task, poll until ready, return tracks.
// Defaults target the sunoapi.org REST contract (compatible with kie.ai).
import { fetchJson, withRetry, sleep } from './util.js';
import { log } from './logger.js';

const TERMINAL_SUCCESS = new Set(['SUCCESS']);
const TERMINAL_FAILURE = new Set([
  'CREATE_TASK_FAILED',
  'GENERATE_AUDIO_FAILED',
  'CALLBACK_EXCEPTION',
  'SENSITIVE_WORD_ERROR',
]);

/** Coerce a timestamp (ISO string, epoch seconds, or epoch ms) to ISO 8601. */
function toIso(v) {
  if (v == null || v === '') return new Date().toISOString();
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    let ms = Number(v);
    if (ms < 1e12) ms *= 1000; // looks like seconds -> convert to ms
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Normalize a provider track object into our canonical shape. */
function normalizeTrack(t = {}) {
  return {
    id: t.id || t.audioId || '',
    title: t.title || 'Untitled',
    audioUrl: t.audioUrl || t.audio_url || '',
    streamAudioUrl: t.streamAudioUrl || t.stream_audio_url || '',
    imageUrl: t.imageUrl || t.image_url || '',
    prompt: t.prompt || '',
    tags: t.tags || '',
    modelName: t.modelName || t.model_name || '',
    duration: typeof t.duration === 'number' ? t.duration : null,
    createTime: toIso(t.createTime || t.create_time),
  };
}

export class SunoClient {
  constructor(cfg, { mock = false } = {}) {
    this.cfg = cfg;
    this.mock = mock;
  }

  get headers() {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /** Submit a generation request. Returns the taskId. */
  async submit({ prompt, instrumental, customMode, model, title, style }) {
    if (this.mock) {
      const taskId = `mock_task_${Buffer.from(prompt).toString('hex').slice(0, 8)}`;
      log.info(`[mock] Submitting Suno task for prompt: "${prompt}" -> ${taskId}`);
      return taskId;
    }

    const payload = {
      prompt,
      customMode: customMode ?? this.cfg.customMode,
      instrumental: instrumental ?? this.cfg.instrumental,
      model: model || this.cfg.model,
    };
    // customMode requires style + title; pass them through when provided.
    if (payload.customMode) {
      if (style) payload.style = style;
      if (title) payload.title = title;
    }
    // Most providers require callBackUrl even though we retrieve results by
    // polling. Send a harmless placeholder when none is configured.
    payload.callBackUrl = this.cfg.callbackUrl || 'https://example.com/lofi-studio/callback';

    const url = `${this.cfg.baseUrl}/api/v1/generate`;
    const body = await withRetry(
      () => fetchJson(url, { method: 'POST', headers: this.headers, body: JSON.stringify(payload) }),
      { label: 'Suno submit' }
    );

    if (body.code && body.code !== 200) {
      throw new Error(`Suno submit rejected (code ${body.code}): ${body.msg || 'unknown error'}`);
    }
    const taskId = body?.data?.taskId || body?.data?.task_id;
    if (!taskId) throw new Error(`Suno submit returned no taskId: ${JSON.stringify(body).slice(0, 300)}`);
    log.info(`Submitted Suno task: ${taskId}`);
    return taskId;
  }

  /** Fetch the current status/details for a task. */
  async getTask(taskId) {
    if (this.mock) {
      return {
        status: 'SUCCESS',
        tracks: [
          normalizeTrack({
            id: `${taskId}_1`,
            title: 'Mock Lo-Fi Beat',
            audioUrl: 'https://example.com/mock/audio.mp3',
            streamAudioUrl: 'https://example.com/mock/stream.mp3',
            imageUrl: 'https://example.com/mock/cover.jpg',
            prompt: 'mock prompt',
            tags: 'lo-fi, chill, study',
            modelName: this.cfg.model,
            duration: 123,
            createTime: '2026-01-01T00:00:00.000Z',
          }),
        ],
      };
    }

    const url = `${this.cfg.baseUrl}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`;
    const body = await withRetry(
      () => fetchJson(url, { method: 'GET', headers: this.headers }),
      { label: 'Suno poll' }
    );
    if (body.code && body.code !== 200) {
      throw new Error(`Suno record-info error (code ${body.code}): ${body.msg || 'unknown'}`);
    }
    const data = body?.data || {};
    const sunoData = data?.response?.sunoData || data?.response?.suno_data || [];
    return {
      status: data.status || 'PENDING',
      errorMessage: data.errorMessage,
      tracks: sunoData.map(normalizeTrack),
    };
  }

  /** Poll until the task reaches a terminal state; return ready tracks. */
  async waitForCompletion(taskId) {
    const { pollIntervalMs, pollTimeoutMs } = this.cfg;
    const deadline = Date.now() + pollTimeoutMs;
    let elapsed = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { status, tracks, errorMessage } = await this.getTask(taskId);
      log.info(`Task ${taskId} status: ${status}` + (tracks.length ? ` (${tracks.length} track(s))` : ''));

      if (TERMINAL_SUCCESS.has(status)) {
        const ready = tracks.filter((t) => t.audioUrl);
        if (ready.length) return ready;
        // SUCCESS but no audio URL yet -> keep polling briefly.
      }
      if (TERMINAL_FAILURE.has(status)) {
        throw new Error(`Suno generation failed for ${taskId}: ${status}${errorMessage ? ` - ${errorMessage}` : ''}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out after ${Math.round(pollTimeoutMs / 1000)}s waiting for task ${taskId} (last status: ${status})`);
      }
      elapsed += pollIntervalMs;
      await sleep(this.mock ? 10 : pollIntervalMs);
    }
  }

  /** Convenience: submit then wait. Returns normalized tracks. */
  async generate(opts) {
    const taskId = await this.submit(opts);
    const tracks = await this.waitForCompletion(taskId);
    return { taskId, tracks };
  }
}
