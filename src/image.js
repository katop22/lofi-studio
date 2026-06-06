// Artwork provider. Strategy-based so future sources (image API, local Stable
// Diffusion on the GPU) can drop in without touching the video pipeline.
import path from 'node:path';
import { downloadFile, sanitizeFilename } from './util.js';
import { buildImagePrompt } from './prompt.js';
import { generateImage } from './comfyui.js';
import { log } from './logger.js';

function extFromUrl(url, fallback = 'jpg') {
  const m = (url || '').split('?')[0].match(/\.(png|jpe?g|webp)$/i);
  return m ? m[1].toLowerCase() : fallback;
}

/**
 * Obtain artwork for a track and return a local image file path.
 * @param track  normalized track ({ title, id, imageUrl, tags, prompt, ... })
 * @param opts   { source, dir, comfyui, prompt }
 * @returns { path, sourceUrl, meta }
 *   sourceUrl is a public URL when one exists (Suno cover) or null for local files.
 */
export async function getArtwork(track, { source = 'suno-cover', dir = './output/artwork', comfyui, prompt } = {}) {
  switch (source) {
    case 'suno-cover': {
      if (!track.imageUrl) {
        throw new Error(`No Suno cover image available for "${track.title}".`);
      }
      const filename = `${sanitizeFilename(track.title)}_${track.id || 'art'}.${extFromUrl(track.imageUrl)}`;
      const local = await downloadFile(track.imageUrl, dir, filename);
      log.info(`Artwork (suno-cover) -> ${path.resolve(local)}`);
      return { path: local, sourceUrl: track.imageUrl };
    }

    case 'local-sd':
    case 'comfyui': {
      if (!comfyui || !prompt) throw new Error('local-sd artwork requires comfyui + prompt config');
      const built = await buildImagePrompt(track, prompt);
      const filename = `${sanitizeFilename(track.title)}_${track.id || 'art'}.png`;
      const dest = path.resolve(dir, filename);
      await generateImage(comfyui, built, dest);
      return { path: dest, sourceUrl: null, meta: { prompt: built.positive, via: built.via, seed: built.seed } };
    }

    default:
      throw new Error(`Unknown ARTWORK_SOURCE "${source}"`);
  }
}
