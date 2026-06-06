#!/usr/bin/env node
// TikTok OAuth 2.0 auth helper (loopback flow, identical pattern to youtube-auth.js).
// Opens a browser for TikTok consent, captures the code, exchanges it for
// access + refresh tokens, and writes them to .env.
//
// Run once (or whenever the access_token expires and refresh fails):
//   npm run auth:tiktok
//
// Sandbox note: All videos posted by unaudited clients are private-only.
// That's fine — it proves the full auth+upload pipeline before production review.
import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { log } from '../logger.js';

const TIKTOK_AUTH_URL  = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
// Start with minimal scope to verify the auth flow works.
// video.upload / video.publish require app review approval — add them back
// once the app is approved or TikTok grants them in sandbox.
const SCOPES = process.env.TIKTOK_SCOPES || 'user.info.basic';
const ENV_PATH         = path.resolve(process.cwd(), '.env');

// Fixed port + path — must match EXACTLY what is registered in TikTok
// Developer Portal → Login Kit → Redirect URIs.
// Registered URI: http://localhost:8765/callback/
const REDIRECT_PORT = 8765;
const REDIRECT_PATH = '/callback/';

// ── PKCE helpers (RFC 7636) ───────────────────────────────────────────────────
// code_verifier: 64 chars, alphanumeric ONLY — avoids any encoding ambiguity.
const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function generateCodeVerifier() {
  return Array.from(randomBytes(64))
    .map(b => VERIFIER_CHARS[b % VERIFIER_CHARS.length])
    .join('');
}
// TikTok PKCE uses HEX encoding (not base64url!) per their official docs:
// "hash the code verifier using hex encoding of SHA256"
function generateCodeChallenge(verifier) {
  return createHash('sha256').update(verifier, 'ascii').digest('hex');
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function upsertEnv(pairs) {
  let text = '';
  try { text = await fsp.readFile(ENV_PATH, 'utf8'); } catch { /* new */ }
  for (const [key, value] of Object.entries(pairs)) {
    const line = `${key}=${value}`;
    const re   = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, line);
    else text = text.replace(/\s*$/, '') + `\n${line}\n`;
  }
  await fsp.writeFile(ENV_PATH, text);
}

function openBrowser(url) {
  try {
    spawn('powershell', ['-NoProfile', '-Command', `Start-Process '${url}'`],
      { windowsHide: true, stdio: 'ignore' });
  } catch { /* ignore */ }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const clientKey    = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error('Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env first.');
  }

  // Fixed-port loopback server — must match the URI registered in the portal.
  const server      = http.createServer();
  const redirectUri = `http://localhost:${REDIRECT_PORT}${REDIRECT_PATH}`;
  await new Promise((resolve, reject) => {
    server.once('error', e => reject(new Error(`Port ${REDIRECT_PORT} in use: ${e.message}. Kill the process using it and retry.`)));
    server.listen(REDIRECT_PORT, '127.0.0.1', resolve);
  });
  log.info(`Redirect URI: ${redirectUri}  ← must match TikTok Developer Portal exactly`);

  // PKCE: generate verifier + challenge before building the auth URL.
  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  // Self-verify the PKCE pair before using it.
  const selfCheck = generateCodeChallenge(codeVerifier);
  if (selfCheck !== codeChallenge) throw new Error('PKCE self-check failed!');
  log.info(`PKCE code_verifier  : ${codeVerifier.slice(0, 12)}… (len ${codeVerifier.length}, alphanumeric)`);
  log.info(`PKCE code_challenge : ${codeChallenge} (S256, self-check ✓)`);

  // TikTok auth URL (PKCE-extended).
  const state  = `lofi_${Date.now()}`;
  const params = new URLSearchParams({
    client_key:            clientKey,
    scope:                 SCOPES,
    response_type:         'code',
    redirect_uri:          redirectUri,
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  });
  const authUrl = `${TIKTOK_AUTH_URL}?${params.toString()}`;

  // Wait for the redirect with the auth code (10-minute window).
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for TikTok consent (10 min)')),
      600_000
    );
    server.on('request', (req, res) => {
      // Ignore favicon and any path that isn't the callback.
      if (!req.url.startsWith(REDIRECT_PATH.replace(/\/$/, ''))) {
        res.writeHead(204); res.end(); return;
      }
      const u           = new URL(req.url, redirectUri);
      const returnedState = u.searchParams.get('state');
      // Strictly reject any callback whose state doesn't EXACTLY match ours.
      // This catches browser-replayed redirects from prior auth attempts.
      if (returnedState !== state) {
        log.warn(`Ignoring stale/mismatched callback (got state="${returnedState}", expected="${state}")`);
        res.writeHead(204); res.end(); return;
      }
      const code   = u.searchParams.get('code');
      const errMsg = u.searchParams.get('error_description') || u.searchParams.get('error');
      const ok     = !!code;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:sans-serif;text-align:center;padding-top:60px">
        <h2>${ok ? '✅ lofi-studio: TikTok authorized!' : '❌ Authorization failed'}</h2>
        <p>${ok ? '認証成功！このタブを閉じてターミナルに戻ってください。' : errMsg || ''}</p>
      </body></html>`);
      clearTimeout(timer);
      if (errMsg && !code) reject(new Error(`TikTok OAuth error: ${errMsg}`));
      else if (code) resolve(code);
      else reject(new Error('No authorization code received'));
    });

    log.info('Opening browser for TikTok consent…');
    log.info(`If it does not open, paste this URL into your browser:\n\n${authUrl}\n`);
    log.info(`Scopes requested: ${SCOPES}`);
    openBrowser(authUrl);
  });

  server.close();
  log.info('Authorization code received; exchanging for tokens…');

  // Exchange code → tokens (include code_verifier for PKCE).
  const body = new URLSearchParams({
    client_key:    clientKey,
    client_secret: clientSecret,
    code,
    grant_type:     'authorization_code',
    redirect_uri:   redirectUri,
    code_verifier:  codeVerifier,   // PKCE S256 proof
  });
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: body.toString(),
  });
  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(
      `Token exchange failed (HTTP ${res.status}): ` +
      `${json.error} — ${json.error_description || JSON.stringify(json)}`
    );
  }

  const { access_token, refresh_token, expires_in, open_id, scope } = json;
  if (!access_token) throw new Error(`No access_token in response: ${JSON.stringify(json)}`);

  // Persist to .env.
  const toSave = { TIKTOK_ACCESS_TOKEN: access_token };
  if (refresh_token) toSave.TIKTOK_REFRESH_TOKEN = refresh_token;
  if (open_id)       toSave.TIKTOK_OPEN_ID        = open_id;
  await upsertEnv(toSave);

  log.info(`✅ Tokens saved to .env:`);
  log.info(`   open_id      : ${open_id}`);
  log.info(`   scope        : ${scope}`);
  log.info(`   expires_in   : ${expires_in}s (~${Math.round(expires_in/3600)}h)`);
  log.info(`   access_token : ${access_token.slice(0,12)}… (len ${access_token.length})`);
  if (refresh_token) log.info(`   refresh_token: ${refresh_token.slice(0,12)}… (len ${refresh_token.length})`);
  log.info('\nNext: run the API sanity check to verify the token works:');
  log.info('  node src/auth/tiktok-test.js');
}

main().catch(err => { log.error(err.message); process.exit(1); });
