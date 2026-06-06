#!/usr/bin/env node
// Fetch Pinterest boards and write PINTEREST_BOARD_ID + PINTEREST_ENABLE to .env.
// Run once after setting PINTEREST_ACCESS_TOKEN in .env.
//   node scripts/setup-pinterest.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../.env');
const API = 'https://api.pinterest.com/v5';

// Load .env manually (no dotenv needed — just key=value parsing)
function loadEnv() {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function setEnvKey(key, value) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  console.log(`  .env: ${key}=${value}`);
}

async function pGet(endpoint, token) {
  const res = await fetch(`${API}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Pinterest API ${res.status} on ${endpoint}: ${data?.message || JSON.stringify(data)}`
    );
  }
  return data;
}

async function pPost(endpoint, token, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Pinterest API ${res.status} on ${endpoint}: ${data?.message || JSON.stringify(data)}`
    );
  }
  return data;
}

async function main() {
  const env = loadEnv();
  const token = env.PINTEREST_ACCESS_TOKEN;
  if (!token) {
    console.error('❌ PINTEREST_ACCESS_TOKEN not set in .env');
    process.exit(1);
  }

  console.log('Fetching Pinterest boards...');
  const data = await pGet('/boards?page_size=25', token);
  const boards = data.items || [];

  if (boards.length > 0) {
    console.log(`\nFound ${boards.length} board(s):`);
    for (const b of boards) {
      console.log(`  [${b.id}] "${b.name}"${b.description ? ' — ' + b.description.slice(0, 60) : ''}`);
    }
  } else {
    console.log('No existing boards found.');
  }

  // Find a lofi/music-themed board
  const LOFI_KEYWORDS = ['lofi', 'lo-fi', 'lo fi', 'chill', 'study', 'beats', 'music', 'relax'];
  let board = boards.find((b) =>
    LOFI_KEYWORDS.some((kw) => b.name.toLowerCase().includes(kw))
  );

  if (!board && boards.length > 0) {
    board = boards[0];
    console.log(`\nNo lofi-themed board found — using first board: "${board.name}"`);
  }

  if (!board) {
    console.log('\nCreating "Lo-Fi Studio" board...');
    board = await pPost('/boards', token, {
      name: 'Lo-Fi Studio',
      description: 'Chilled lo-fi beats for studying, relaxing, and focusing. 🎧☕',
      privacy: 'PUBLIC',
    });
    console.log(`Created board [${board.id}] "${board.name}"`);
  }

  console.log(`\n✓ Selected board: "${board.name}" (id: ${board.id})`);
  setEnvKey('PINTEREST_BOARD_ID', board.id);
  setEnvKey('PINTEREST_ENABLE', 'true');

  console.log('\n✓ .env updated. Run the ship test with:');
  console.log('  npm run ship -- --channels pinterest --limit 1');
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  console.error('\nPinterest API access troubleshooting:');
  console.error('  Error code 3 = "consumer type not supported"');
  console.error('  Fix: Go to https://developers.pinterest.com/apps/');
  console.error('  → Open your app → App Settings');
  console.error('  → App Type must be "Standard" (not "Marketing API")');
  console.error('  → Ensure scopes include: boards:read boards:write pins:read pins:write');
  console.error('  → Regenerate your access token after fixing the app type');
  process.exit(1);
});
