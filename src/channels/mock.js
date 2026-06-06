// A fully working, credential-free channel used to prove the end-to-end
// shipping pipeline (caption -> post -> Airtable write-back -> idempotency)
// without touching any real SNS. Enable with `--channels mock` or MOCK_ENABLE=true.
import { Channel } from './base.js';
import { log } from '../logger.js';

export const mockChannel = new Channel({
  key: 'mock',
  label: 'Mock (test)',
  mediaKind: 'landscape',
  captionStyle: 'video',
  priority: 1, // goes first so it can supply a canonical URL for text-channel demos
  enableKey: 'MOCK_ENABLE',
  requiredEnv: [],
  providesCanonicalUrl: true,
  implemented: true,
  async post(ctx) {
    const id = `mock_${ctx.track.id || 'x'}_${ctx.channel.key}`;
    const url = `https://mock.lofi.local/${ctx.channel.key}/${encodeURIComponent(id)}`;
    log.info(`[mock] "posted" ${ctx.track.title} -> ${url}`);
    return {
      url,
      id,
      evidence: {
        captionTitle: ctx.caption.title,
        captionPreview: (ctx.caption.body || '').slice(0, 120),
        mediaUsed: ctx.media?.videoPath || null,
      },
    };
  },
});
