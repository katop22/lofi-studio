// ComfyUI API client: submit an SDXL hires-fix workflow, wait, fetch the image.
// Uses a two-pass (base render -> latent upscale -> refine) graph so we get a
// native ~1080p image with no external upscaler model (license-clean).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fetchJson, sleep } from './util.js';
import { log } from './logger.js';

const CLIENT_ID = 'lofi-studio';

/** Construct the ComfyUI API-format prompt graph. */
export function buildWorkflow(cfg, { positive, negative, seed }) {
  return {
    4: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: cfg.checkpoint },
    },
    6: {
      class_type: 'CLIPTextEncode',
      inputs: { text: positive, clip: ['4', 1] },
    },
    7: {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['4', 1] },
    },
    5: {
      class_type: 'EmptyLatentImage',
      inputs: { width: cfg.baseWidth, height: cfg.baseHeight, batch_size: 1 },
    },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: cfg.steps,
        cfg: cfg.cfg,
        sampler_name: cfg.sampler,
        scheduler: cfg.scheduler,
        denoise: 1.0,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    10: {
      class_type: 'LatentUpscale',
      inputs: {
        upscale_method: 'nearest-exact',
        width: cfg.width,
        height: cfg.height,
        crop: 'disabled',
        samples: ['3', 0],
      },
    },
    11: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: cfg.hiresSteps,
        cfg: cfg.cfg,
        sampler_name: cfg.sampler,
        scheduler: cfg.scheduler,
        denoise: cfg.hiresDenoise,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['10', 0],
      },
    },
    8: {
      class_type: 'VAEDecode',
      inputs: { samples: ['11', 0], vae: ['4', 2] },
    },
    9: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'lofi', images: ['8', 0] },
    },
  };
}

/** Ping the server; throws a helpful error if it isn't reachable. */
export async function ensureServer(cfg) {
  try {
    const stats = await fetchJson(`${cfg.url}/system_stats`, {}, { timeoutMs: 5000 });
    const dev = stats?.devices?.[0]?.name || 'unknown device';
    log.info(`ComfyUI reachable at ${cfg.url} (${dev})`);
    return stats;
  } catch (err) {
    throw new Error(
      `ComfyUI not reachable at ${cfg.url} (${err.message}). ` +
        'Start it with: <venv> ComfyUI/main.py --listen 127.0.0.1 --port 8188'
    );
  }
}

async function queuePrompt(cfg, graph) {
  const body = await fetchJson(`${cfg.url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: CLIENT_ID }),
  });
  if (!body.prompt_id) {
    throw new Error(`ComfyUI rejected the prompt: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body.prompt_id;
}

async function waitForImage(cfg, promptId) {
  const deadline = Date.now() + cfg.timeoutMs;
  while (Date.now() < deadline) {
    const hist = await fetchJson(`${cfg.url}/history/${promptId}`, {}, { timeoutMs: 10000 });
    const entry = hist[promptId];
    if (entry) {
      const statusStr = entry.status?.status_str;
      if (statusStr === 'error') {
        const msg = (entry.status?.messages || [])
          .filter((m) => m[0] === 'execution_error')
          .map((m) => m[1]?.exception_message)
          .join('; ');
        throw new Error(`ComfyUI execution error: ${msg || 'unknown'}`);
      }
      // Find the SaveImage node output.
      for (const out of Object.values(entry.outputs || {})) {
        if (out.images && out.images.length) return out.images[0];
      }
      if (entry.status?.completed) {
        throw new Error('ComfyUI finished but produced no image');
      }
    }
    await sleep(2000);
  }
  throw new Error(`Timed out after ${Math.round(cfg.timeoutMs / 1000)}s waiting for ComfyUI`);
}

async function fetchImage(cfg, image, destPath) {
  const q = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || '',
    type: image.type || 'output',
  });
  const res = await fetch(`${cfg.url}/view?${q.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch image from ComfyUI (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await fsp.writeFile(destPath, buf);
  return destPath;
}

/** End-to-end: generate one image and save it to destPath. */
export async function generateImage(cfg, prompt, destPath) {
  await ensureServer(cfg);
  const graph = buildWorkflow(cfg, prompt);
  const promptId = await queuePrompt(cfg, graph);
  log.info(`ComfyUI queued prompt ${promptId}; generating ${cfg.width}x${cfg.height}...`);
  const image = await waitForImage(cfg, promptId);
  await fetchImage(cfg, image, destPath);
  log.info(`ComfyUI image saved -> ${path.resolve(destPath)}`);
  return destPath;
}
