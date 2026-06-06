# lofi-studio

Automated Lo-Fi music generation and distribution system.

**Phase 1 (this milestone):** generate music with the Suno AI API, then store
each track's metadata (title, audio URL, generation time, …) in Airtable.

```
prompt ──▶ Suno API (generate → poll) ──▶ tracks ──▶ download (optional)
                                                  └──▶ Airtable record
```

## Requirements

- Node.js >= 18 (developed/tested on Node 22)
- A Suno API key (from a provider such as [sunoapi.org](https://sunoapi.org) or
  [kie.ai](https://kie.ai))
- An Airtable Personal Access Token + Base ID

## Setup

```bash
npm install
cp .env.example .env   # then fill in your credentials
```

### Airtable table schema

Create a table (default name **`Tracks`**) with these columns. Column names are
defined in `FIELD_MAP` in `src/airtable.js` — rename there if your table differs.

| Column        | Type                 |
| ------------- | -------------------- |
| Title         | Single line text     |
| Prompt        | Long text            |
| Audio URL     | URL                  |
| Stream URL    | URL                  |
| Image URL     | URL                  |
| Tags          | Single line text     |
| Model         | Single line text     |
| Duration      | Number               |
| Suno ID       | Single line text     |
| Task ID       | Single line text     |
| Generated At  | Date (incl. time)    |
| Status        | Single line / Select |
| Local Path    | Single line text     |
| Audio         | Attachment (optional, set `AIRTABLE_ATTACH_AUDIO=false` to skip) |

## Usage

```bash
# Use the default prompt from .env
npm run generate

# Custom prompt
npm run generate -- --prompt "Rainy night lo-fi for deep focus"

# Phase 2: render videos for all pending tracks (artwork + Ken Burns + ffmpeg)
npm run render

# Render a single record / disable motion / re-render
npm run render -- --record recXXXXXXXX
npm run render -- --static
npm run render -- --force --limit 1

# Full pipeline with NO credentials and NO network (mocked Suno + Airtable)
npm run generate -- --dry-run

# Help
node src/index.js --help
```

### Options

| Flag                  | Description                                   |
| --------------------- | --------------------------------------------- |
| `-p, --prompt <text>` | Music prompt (defaults to `DEFAULT_PROMPT`)   |
| `-t, --title <text>`  | Title (custom mode / file naming)             |
| `-m, --model <name>`  | Override Suno model                           |
| `--task <taskId>`     | Re-store an existing Suno task into Airtable (no generation / no credits) |
| `--instrumental`      | Force instrumental                            |
| `--no-instrumental`   | Force vocals                                  |
| `--no-download`       | Don't save the audio binary locally           |
| `--dry-run`           | Exercise the whole pipeline offline           |

## Configuration

All secrets and tuning live in `.env` (see `.env.example` for the full list and
defaults). Nothing is hard-coded.

## Security

- `.env` is git-ignored — never commit real credentials.
- This machine uses TLS interception; Node trusts the exported corporate root
  bundle via `NODE_EXTRA_CA_CERTS` (`~/tools/win-ca-bundle.pem`), set in the
  user environment during setup.

## Project layout

```
src/
  index.js     # CLI entry / orchestrator
  config.js    # env loading + validation
  suno.js      # Suno client (submit → poll → normalize)
  airtable.js  # Airtable storage + field mapping
  util.js      # retry, fetch, download helpers
  logger.js    # leveled logger
```

## Phase 2 — artwork & video

`npm run render` reads tracks from Airtable whose `Video Status` is empty/Pending,
reuses the Suno cover art, and composes a YouTube-ready mp4 (1920×1080, H.264/AAC)
with a slow **Ken Burns** zoom via the bundled `ffmpeg-static` binary. The video
path, artwork, and `Video Status = Video Ready` are written back to Airtable.
All video tuning lives in `.env` (`VIDEO_*`, `ARTWORK_SOURCE`).

## Phase 2.5 — local Stable Diffusion artwork (ComfyUI + Ollama)

Set `ARTWORK_SOURCE=local-sd` to generate **native 1920×1080** anime artwork
instead of upscaling the soft ~360×360 Suno cover. Pipeline:

1. **Ollama** (local LLM, default `dolphin-llama3`) translates the track's
   musical vibe into a vivid Studio-Ghibli-inspired scene prompt.
2. **ComfyUI** renders it with **Animagine XL** (SDXL) via a two-pass hires-fix
   workflow (1344×768 → latent upscale → 1920×1080), no external upscaler.
3. The PNG drives the Ken Burns video; a JPG thumbnail is uploaded to the
   Airtable `Artwork` field and the path stored in `Artwork Path`.

### Prerequisites & running

ComfyUI lives in `%USERPROFILE%\ComfyUI` (separate clean venv, Python 3.11,
PyTorch **cu128** for the RTX 5060 Ti / Blackwell sm_120). Ollama must be running
with the model pulled.

```bash
# 1. Start the ComfyUI API server (keep the window open)
start-comfyui.bat
# 2. Render — uses local SD because ARTWORK_SOURCE=local-sd in .env
npm run render -- --force
```

If ComfyUI isn't reachable, render fails fast with a clear message. To fall back
to the zero-setup cover art, set `ARTWORK_SOURCE=suno-cover`.

## Phase 3 — multi-SNS distribution

`npm run ship` distributes rendered videos to many SNS through a pluggable
channel registry (`src/sns.js`). Captions are generated by Ollama in two
variants and routed by channel type:

- **video** channels (YouTube, TikTok, IG Reels): title + emotive description + hashtags
- **text** channels (X, Threads, Reddit, Pinterest): one emotive post (X omits the link by default — links cost ~$0.20/post on X in 2026)

Each successful post is written back to Airtable immediately (`Post Log` JSON +
the channel's URL column). When **every targeted channel** has succeeded,
`Video Status` becomes `Uploaded`. Re-runs are **idempotent** — already-posted
channels are skipped; only the missing ones retry.

```bash
# Prove the whole pipeline with the credential-free mock channel
npm run ship -- --channels mock

# Once real channels are wired + enabled (see manual below)
npm run ship                      # all "Video Ready" records, all enabled channels
npm run ship -- --channels youtube,x --limit 1
npm run ship -- --record recXXXX --force
```

### Adding a new SNS (plugin pattern)

1. Create `src/channels/<name>.js` exporting a `Channel` (see `channels/base.js`).
2. Implement `async post(ctx)` → `{ url, id, evidence }`.
3. Register it in the `CHANNELS` array in `src/sns.js`.
4. Add its `*_ENABLE` flag + credentials to `.env`.

No other code changes — enable/disable, captioning, idempotent write-back, and
the status flip all work automatically.

### Account & API setup manual (do these as accounts/keys arrive)

All channels ship as **scaffolds**: inactive until enabled *and* configured.
A channel's `post()` throws until its real API code is added, so nothing
silently no-ops.

| Channel | What to obtain | Where | Notes |
| ------- | -------------- | ----- | ----- |
| **YouTube** | OAuth2 client + refresh token (`youtube.upload` scope) | Google Cloud Console → enable *YouTube Data API v3* → OAuth consent + credentials | Direct mp4 upload; its watch URL is the canonical link for text channels |
| **YouTube Shorts** | same YouTube creds | — | needs a vertical ≤60s cut (deferred); blocked until that media exists |
| **Instagram Reels** | Page access token + IG Business account id | Meta for Developers → app → Instagram Graph API | Business/Creator only; Reels = 9:16, ≤90s (needs vertical media) |
| **X** | API key/secret + access token/secret | developer.x.com → project/app (OAuth 1.0a) | Pay-per-use in 2026; keep `SNS_X_INCLUDE_LINK=false` to avoid the link surcharge |
| **TikTok** | client key/secret + user access token | developers.tiktok.com → Content Posting API | Requires app audit/approval; vertical media |
| **Threads** | access token + Threads user id | Meta for Developers → Threads API | Similar to Instagram |
| **Reddit** | script-app client id/secret + username/password + target subreddit | reddit.com/prefs/apps | Posts a link to the canonical URL; obey subreddit rules |
| **Pinterest** | access token + board id | developers.pinterest.com (API v5) | App approval required |

Then set the matching `<NAME>_ENABLE=true` and credentials in `.env`, and either
add the key to `SNS_CHANNELS` or rely on the ENABLE flag.

## Dashboard (operator UI)

A minimal **Streamlit** dashboard wraps the Node pipeline (it shells out to the
`npm run …` commands — backend stays untouched). Three blocks:

1. **指令室 / Command Room** — theme input + AI-suggested prompt (Ollama) you can hand-edit
2. **工場モニター / Factory Monitor** — status, service health, run log, latest video/artwork preview
3. **発射ボタン / Launch** — channel checkboxes + the "🚀 連携SNSへ一斉出荷！" button (generate → render → ship)

```bash
run-dashboard.bat        # first run creates ui/.venv + installs Streamlit, then launches
# → http://localhost:8501
```

A **Mock mode** toggle (on by default) simulates runs with no Suno/YouTube cost.
Turn it off for live runs (ComfyUI + Ollama must be running).

The UI is modular (`ui/backend.py` is the only seam to the pipeline): a future
"infinite-loop full-auto" button just calls `backend.run_pipeline()` in a loop —
the extension point is already stubbed in `ui/components/launch.py`.

## Roadmap

- ~~Phase 1: Suno generation → Airtable~~ ✅
- ~~Phase 2: artwork + video rendering~~ ✅
- ~~Phase 2.5: local Stable Diffusion artwork (RTX 5060 Ti) for hi-res covers~~ ✅
- ~~Phase 3: multi-SNS distribution framework (pluggable channels)~~ ✅ *(framework + mock; real APIs wired as accounts arrive)*
- Phase 3.x: wire real channel APIs (YouTube first) + vertical short-form render
- Phase 4: scheduling / orchestration
