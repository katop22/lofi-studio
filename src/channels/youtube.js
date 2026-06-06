// Real YouTube channel: uploads the rendered mp4 via the Data API v3
// (resumable upload through googleapis). Its watch URL becomes the canonical
// link shared by text channels.
import fs from 'node:fs';
import { google } from 'googleapis';
import { Channel } from './base.js';
import { log } from '../logger.js';

function youtubeClient(env) {
  const oauth2 = new google.auth.OAuth2(env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: env.YOUTUBE_REFRESH_TOKEN });
  return google.youtube({ version: 'v3', auth: oauth2 });
}

/** Pull up to 15 hashtag words from the caption to use as YouTube tags. */
function tagsFromCaption(caption) {
  const body = `${caption?.body || ''}`;
  return [...body.matchAll(/#(\w+)/g)].map((m) => m[1]).slice(0, 15);
}

export const youtubeChannel = new Channel({
  key: 'youtube',
  label: 'YouTube',
  mediaKind: 'landscape',
  captionStyle: 'video',
  priority: 10,
  providesCanonicalUrl: true,
  enableKey: 'YOUTUBE_ENABLE',
  requiredEnv: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
  implemented: true,

  async post(ctx) {
    const env = ctx.env;
    const videoPath = ctx.media.videoPath;
    if (!videoPath || !fs.existsSync(videoPath)) {
      throw new Error(`video file not found: ${videoPath}`);
    }
    const privacy = (env.YOUTUBE_PRIVACY || 'unlisted').toLowerCase(); // unlisted | public | private
    const title = (ctx.caption.title || ctx.track.title || 'lofi').slice(0, 100);
    const description = (ctx.caption.body || '').slice(0, 4900);

    const yt = youtubeClient(env);
    log.info(`  [youtube] uploading "${title}" (${privacy})...`);
    const res = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description, tags: tagsFromCaption(ctx.caption), categoryId: '10' /* Music */ },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      },
      media: { body: fs.createReadStream(videoPath) },
    });

    const id = res.data.id;
    if (!id) throw new Error(`upload returned no video id: ${JSON.stringify(res.data).slice(0, 200)}`);
    return { url: `https://youtu.be/${id}`, id, evidence: { privacy, title } };
  },
});
