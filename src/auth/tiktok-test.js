#!/usr/bin/env node
// Sanity-check the TikTok access token WITHOUT posting anything.
// Calls GET /v2/user/info/ — the lightest read endpoint.
//
//   npm run test:tiktok
import 'dotenv/config';
import { log } from '../logger.js';

const BASE = 'https://open.tiktokapis.com';

async function callApi(path, token, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const token    = process.env.TIKTOK_ACCESS_TOKEN;
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!token)     throw new Error('TIKTOK_ACCESS_TOKEN not set. Run: npm run auth:tiktok');
  if (!clientKey) throw new Error('TIKTOK_CLIENT_KEY not set in .env');

  log.info('=== TikTok API sanity check ===');
  log.info(`token  : ${token.slice(0,12)}… (len ${token.length})`);
  log.info(`open_id: ${process.env.TIKTOK_OPEN_ID || '(not set)'}`);

  // ── 1. User info ──────────────────────────────────────────────────────────
  log.info('\n[1/2] GET /v2/user/info/ (requires user.info.basic scope)');
  const { status: uStatus, body: uBody } = await callApi(
    '/v2/user/info/',
    token,
    { fields: 'open_id,display_name,avatar_url' }
  );
  log.info(`  HTTP ${uStatus}`);
  if (uBody?.data) {
    // TikTok returns data.user.* or data.* depending on version
    const d = uBody.data?.user ?? uBody.data;
    log.info(`  ✅ display_name: ${d.display_name ?? '(not returned — normal for sandbox)'}`);
    log.info(`  ✅ open_id     : ${d.open_id ?? process.env.TIKTOK_OPEN_ID}`);
    log.info(`  ✅ raw keys    : ${Object.keys(uBody.data).join(', ')}`);
  } else {
    log.warn(`  response: ${JSON.stringify(uBody).slice(0, 300)}`);
    if (uBody?.error?.code === 'access_token_invalid') {
      log.error('  Token is invalid or expired. Re-run: npm run auth:tiktok');
    }
  }

  // ── 2. Creator info (needed before upload) ────────────────────────────────
  log.info('\n[2/2] POST /v2/post/publish/creator_info/query/ (video.upload scope)');
  const ciRes = await fetch(`${BASE}/v2/post/publish/creator_info/query/`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({}),
  });
  const ciBody = await ciRes.json();
  log.info(`  HTTP ${ciRes.status}`);
  if (ciBody?.data) {
    const d = ciBody.data;
    log.info(`  ✅ creator_username       : ${d.creator_username}`);
    log.info(`  ✅ creator_avatar_url     : ${d.creator_avatar_url?.slice(0,60)}…`);
    log.info(`  ✅ max_video_post_duration: ${d.max_video_post_duration}s`);
    log.info(`  ✅ privacy_level_options  : ${JSON.stringify(d.privacy_level_options)}`);
    log.info(`  ✅ duet_disabled          : ${d.duet_disabled}`);
  } else {
    const errCode = ciBody?.error?.code;
    log.warn(`  response: ${JSON.stringify(ciBody).slice(0, 300)}`);
    if (errCode === 'scope_not_authorized') {
      log.warn('  video.upload scope not granted yet. Re-run auth after enabling the scope in the developer portal.');
    }
  }

  log.info('\n=== check complete ===');
}

main().catch(err => { log.error(err.message); process.exit(1); });
