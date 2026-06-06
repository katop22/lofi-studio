#!/usr/bin/env node
// One-time YouTube OAuth helper (installed-app loopback flow).
// Opens a browser for consent, captures the code on 127.0.0.1, exchanges it for
// a refresh token, and saves YOUTUBE_REFRESH_TOKEN into .env. Run once:
//   npm run auth:youtube
import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { google } from 'googleapis';
import { log } from '../logger.js';

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const ENV_PATH = path.resolve(process.cwd(), '.env');

async function upsertEnv(key, value) {
  let text = '';
  try {
    text = await fsp.readFile(ENV_PATH, 'utf8');
  } catch {
    /* new file */
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, line);
  else text = text.replace(/\s*$/, '') + `\n${line}\n`;
  await fsp.writeFile(ENV_PATH, text);
}

function openBrowser(url) {
  // Best-effort; if it fails the user can copy the printed URL.
  try {
    spawn('powershell', ['-NoProfile', '-Command', `Start-Process '${url}'`], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    /* ignore */
  }
}

async function main() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first.');
  }

  // Start a loopback server on an ephemeral port (Desktop OAuth clients allow any loopback port).
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}`;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for consent (10 min)')), 600000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirectUri);
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<html><body style="font-family:sans-serif;text-align:center;padding-top:60px">
         <h2>${c ? '✅ lofi-studio: YouTube authorized' : '❌ Authorization failed'}</h2>
         <p>You can close this tab and return to the terminal.</p></body></html>`
      );
      clearTimeout(timer);
      if (err) reject(new Error(`OAuth error: ${err}`));
      else if (c) resolve(c);
      else reject(new Error('No authorization code received'));
    });

    log.info('Opening browser for Google consent...');
    log.info(`If it does not open, paste this URL into your browser:\n\n${authUrl}\n`);
    openBrowser(authUrl);
  });

  server.close();
  log.info('Authorization code received; exchanging for tokens...');
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token returned. Revoke prior access at myaccount.google.com/permissions and re-run ' +
        '(we request prompt=consent + access_type=offline, which should yield one).'
    );
  }
  await upsertEnv('YOUTUBE_REFRESH_TOKEN', tokens.refresh_token);
  log.info('✅ Saved YOUTUBE_REFRESH_TOKEN to .env. YouTube channel is now configured.');
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
