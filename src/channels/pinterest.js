// Real Pinterest channel: creates a Pin via Pinterest API v5.
// Uses the track artwork as thumbnail, Ollama description, and YouTube canonical URL as the Pin link.
import { Channel } from './base.js';
import { log } from '../logger.js';

const PINTEREST_API = 'https://api.pinterest.com/v5';

async function pFetch(endpoint, token, { method = 'GET', body } = {}) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${PINTEREST_API}${endpoint}`, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Pinterest ${res.status}: unparseable response`);
  }
  if (!res.ok) {
    const msg = data?.message || String(data?.code || '') || `HTTP ${res.status}`;
    throw new Error(`Pinterest API ${res.status}: ${msg}`);
  }
  return data;
}

export const pinterestChannel = new Channel({
  key: 'pinterest',
  label: 'Pinterest',
  // Pinterest pins link to the canonical YouTube URL and display the artwork image.
  // Using 'link' mediaKind ensures we have a canonical URL before this channel runs
  // (YouTube posts first at priority 10; Pinterest at priority 40).
  mediaKind: 'link',
  captionStyle: 'text',
  priority: 40,
  enableKey: 'PINTEREST_ENABLE',
  requiredEnv: ['PINTEREST_ACCESS_TOKEN', 'PINTEREST_BOARD_ID'],
  implemented: true,

  async post(ctx) {
    const env = ctx.env;
    const token = env.PINTEREST_ACCESS_TOKEN;
    const boardId = env.PINTEREST_BOARD_ID;

    // Prefer the SD-generated artwork; fall back to Suno's preview image.
    const imageUrl =
      ctx.track.artworkUrl ||
      ctx.track.imageUrl ||
      (ctx.track.imageUrls && ctx.track.imageUrls[0]) ||
      '';

    if (!imageUrl) {
      throw new Error(
        'No artwork image URL available for Pinterest pin ' +
          '(track needs artworkUrl or imageUrl populated in Airtable)'
      );
    }

    const title = (ctx.caption.title || ctx.track.title || 'Lo-Fi Beats').slice(0, 100);
    // text caption body: emotive post + optional link already assembled by assembleCaption
    const description = (ctx.caption.body || '').slice(0, 800);
    const link = ctx.canonicalUrl || '';

    const pinBody = {
      board_id: boardId,
      title,
      description,
      media_source: {
        source_type: 'image_url',
        url: imageUrl,
      },
    };
    if (link) pinBody.link = link;

    log.info(`  [pinterest] creating pin "${title}" on board ${boardId}...`);
    log.info(`  [pinterest] image: ${imageUrl}`);
    if (link) log.info(`  [pinterest] link:  ${link}`);

    const pin = await pFetch('/pins', token, { method: 'POST', body: pinBody });
    const pinId = pin.id;
    if (!pinId) {
      throw new Error(
        `Pinterest pin creation returned no id: ${JSON.stringify(pin).slice(0, 200)}`
      );
    }

    const url = `https://www.pinterest.com/pin/${pinId}/`;
    return { url, id: pinId, evidence: { title, boardId, imageUrl } };
  },
});
