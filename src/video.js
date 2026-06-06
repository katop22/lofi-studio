// Video compositor: combine a still artwork + audio into a YouTube-ready mp4.
// Uses the bundled ffmpeg-static binary (no system install required).
// Applies a slow Ken Burns zoom for that "living" lo-fi feel.
import fsp from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { runProcess, probeDurationSec } from './util.js';
import { log } from './logger.js';

/** Build the ffmpeg filtergraph + args for a Ken Burns (zoom) render. */
function kenBurnsArgs({ imagePath, audioPath, outPath, durationSec, cfg }) {
  const { width, height, fps, zoomMax, crf, preset, audioBitrate } = cfg;
  const frames = Math.max(1, Math.round(durationSec * fps));
  const d = frames + fps * 2; // small buffer; -shortest trims to audio
  const inc = ((zoomMax - 1) / frames).toFixed(8); // complete the zoom over the track
  const ss = `${width * 2}:${height * 2}`; // supersample to keep the zoom smooth

  const vf =
    `[0:v]scale=${ss}:force_original_aspect_ratio=increase,crop=${ss},` +
    `zoompan=z='min(zoom+${inc},${zoomMax})':d=${d}:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps},` +
    `format=yuv420p[v]`;

  return [
    '-y',
    '-i', imagePath,
    '-i', audioPath,
    '-filter_complex', vf,
    '-map', '[v]',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-r', String(fps),
    '-c:a', 'aac',
    '-b:a', audioBitrate,
    '-shortest',
    '-movflags', '+faststart',
    outPath,
  ];
}

/** Build args for a simple static (no motion) render. */
function staticArgs({ imagePath, audioPath, outPath, cfg }) {
  const { width, height, fps, crf, preset, audioBitrate } = cfg;
  const vf =
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},format=yuv420p[v]`;
  return [
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-i', audioPath,
    '-filter_complex', vf,
    '-map', '[v]',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-preset', preset,
    '-tune', 'stillimage',
    '-crf', String(crf),
    '-r', String(fps),
    '-c:a', 'aac',
    '-b:a', audioBitrate,
    '-shortest',
    '-movflags', '+faststart',
    outPath,
  ];
}

/**
 * Render an mp4 from a still image + audio.
 * @returns { path, durationSec }
 */
export async function renderVideo({ imagePath, audioPath, outPath, durationSec, cfg }) {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not found — run `npm install`.');
  await fsp.mkdir(path.dirname(outPath), { recursive: true });

  // Resolve duration: prefer the supplied value, else probe the audio file.
  let dur = Number(durationSec);
  if (!Number.isFinite(dur) || dur <= 0) {
    dur = await probeDurationSec(ffmpegPath, audioPath);
    if (!dur) throw new Error(`Could not determine audio duration for ${audioPath}`);
  }

  const args = cfg.kenBurns
    ? kenBurnsArgs({ imagePath, audioPath, outPath, durationSec: dur, cfg })
    : staticArgs({ imagePath, audioPath, outPath, cfg });

  log.info(`Rendering video (${cfg.kenBurns ? 'Ken Burns' : 'static'}, ${cfg.width}x${cfg.height}@${cfg.fps}, ~${dur.toFixed(1)}s) -> ${path.basename(outPath)}`);

  let lastLogged = 0;
  await runProcess(ffmpegPath, args, {
    onStderr: (s) => {
      const m = s.match(/time=(\d+):(\d+):(\d+)/);
      if (m) {
        const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        if (t - lastLogged >= 15) {
          lastLogged = t;
          log.info(`  …encoded ${t}s / ~${Math.round(dur)}s`);
        }
      }
    },
  });

  const stat = await fsp.stat(outPath);
  log.info(`✓ Video written: ${path.resolve(outPath)} (${(stat.size / 1e6).toFixed(2)} MB)`);
  return { path: outPath, durationSec: dur, bytes: stat.size };
}
