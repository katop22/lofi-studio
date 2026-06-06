// Real X (Twitter) channel: posts a text-only tweet via the v2 API
// (OAuth 1.0a user context). Per the SNS_X_INCLUDE_LINK=false strategy, the
// body is the Ollama emotive caption + hashtags ONLY — no YouTube link.
// (The link is already excluded upstream by assembleCaption; we never add one.)
import { TwitterApi } from 'twitter-api-v2';
import { Channel } from './base.js';
import { log } from '../logger.js';

const MAX_TWEET = 280;

export const xChannel = new Channel({
  key: 'x',
  label: 'X',
  mediaKind: 'text', // text-only post; no media/link required
  captionStyle: 'text',
  priority: 50,
  providesCanonicalUrl: false,
  enableKey: 'X_ENABLE',
  requiredEnv: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'],
  implemented: true,

  async post(ctx) {
    const env = ctx.env;
    const client = new TwitterApi({
      appKey: env.X_API_KEY,
      appSecret: env.X_API_SECRET,
      accessToken: env.X_ACCESS_TOKEN,
      accessSecret: env.X_ACCESS_SECRET,
    });

    let text = (ctx.caption.body || '').trim();
    // Defensive: strip any stray URL so the no-link strategy is guaranteed.
    text = text.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!text) throw new Error('empty tweet text');
    if (text.length > MAX_TWEET) text = text.slice(0, MAX_TWEET - 1).trim();

    log.info(`  [x] posting tweet (${text.length} chars, no link)...`);
    let res;
    try {
      res = await client.readWrite.v2.tweet(text);
    } catch (err) {
      // Surface X's structured problem detail (e.g. 402 CreditsDepleted, 403 perms).
      const d = err?.data;
      const detail = d?.detail || d?.title || err?.message || String(err);
      throw new Error(`X API ${err?.code || ''} ${detail}`.trim());
    }
    const id = res?.data?.id;
    if (!id) throw new Error(`tweet returned no id: ${JSON.stringify(res).slice(0, 200)}`);

    return { url: `https://x.com/i/web/status/${id}`, id, evidence: { text } };
  },
});
