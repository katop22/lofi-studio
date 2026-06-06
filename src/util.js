// Shared utilities: sleep, retry-with-backoff, resilient JSON fetch, downloads.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { log } from './logger.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` with exponential backoff. Retries on thrown errors and on
 * errors flagged `err.retryable === true`.
 */
export async function withRetry(fn, { retries = 4, baseMs = 1000, label = 'operation' } = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      attempt += 1;
      const retryable = err?.retryable !== false;
      if (attempt > retries || !retryable) throw err;
      const delay = baseMs * 2 ** (attempt - 1);
      log.warn(`${label} failed (attempt ${attempt}/${retries}): ${err.message}. Retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

/** A fetch that parses JSON and throws rich, classified errors. */
export async function fetchJson(url, options = {}, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    // Network / abort errors are transient -> retryable.
    const e = new Error(`Network error calling ${url}: ${err.message}`);
    e.retryable = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const e = new Error(`HTTP ${res.status} from ${url}: ${text?.slice(0, 500)}`);
    e.status = res.status;
    e.body = body;
    // 429 + 5xx are transient; 4xx (except 429) are not.
    e.retryable = res.status === 429 || res.status >= 500;
    throw e;
  }
  return body;
}

export function sanitizeFilename(name) {
  return (name || 'track')
    .replace(/[^\w\-. ]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'track';
}

/** Stream-download a URL to disk. Returns the absolute file path. */
export async function downloadFile(url, destDir, filename) {
  await fsp.mkdir(destDir, { recursive: true });
  const dest = path.resolve(destDir, filename);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download (${res.status}) from ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  return dest;
}

/**
 * Spawn a process and resolve with its captured stderr/stdout. Rejects on a
 * non-zero exit unless `allowNonZero` is set (used for `ffmpeg -i` probing).
 */
export function runProcess(bin, args, { onStderr, allowNonZero = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (onStderr) onStderr(s);
    });
    proc.on('error', (err) => reject(new Error(`Failed to launch ${bin}: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0 || allowNonZero) resolve({ code, stdout, stderr });
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

/** Parse a media file's duration (seconds) by inspecting ffmpeg's output. */
export async function probeDurationSec(ffmpegBin, file) {
  const { stderr } = await runProcess(ffmpegBin, ['-i', file], { allowNonZero: true });
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
