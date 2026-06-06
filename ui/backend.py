# Backend bridge: the ONLY layer that talks to the Node pipeline + Ollama.
# UI components call these functions; swapping mock<->live or adding an
# infinite-loop runner later means touching only this file.
import os
import json
import time
import shutil
import subprocess
import urllib.request
from pathlib import Path

import config


# --------------------------------------------------------------------------- #
# Environment / process helpers
# --------------------------------------------------------------------------- #
def _env():
    env = os.environ.copy()
    if config.NODE_DIR.exists():
        env["PATH"] = str(config.NODE_DIR) + os.pathsep + env.get("PATH", "")
    if config.CA_BUNDLE.exists():
        env["NODE_EXTRA_CA_CERTS"] = str(config.CA_BUNDLE)
    # Use the hi-res local Stable Diffusion artwork path by default.
    env.setdefault("ARTWORK_SOURCE", "local-sd")
    return env


def _npm_exe():
    cand = config.NODE_DIR / "npm.cmd"
    if cand.exists():
        return str(cand)
    return shutil.which("npm") or "npm"


def _node_exe():
    cand = config.NODE_DIR / "node.exe"
    if cand.exists():
        return str(cand)
    return shutil.which("node") or "node"


def run_npm(script, extra=None, on_line=None):
    """Run `npm run <script> [-- extra...]`, streaming combined output to on_line.
    Returns True on exit code 0."""
    cmd = [_npm_exe(), "run", script]
    if extra:
        cmd += ["--", *extra]
    if on_line:
        on_line(f"$ npm run {script} {' '.join(extra or [])}".rstrip())
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(config.PROJECT_ROOT),
            env=_env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except FileNotFoundError as e:
        if on_line:
            on_line(f"[error] could not launch npm: {e}")
        return False
    for line in proc.stdout:
        if on_line:
            on_line(line.rstrip())
    proc.wait()
    ok = proc.returncode == 0
    if on_line:
        on_line(f"[exit {proc.returncode}]")
    return ok


# --------------------------------------------------------------------------- #
# Prompt suggestion (Ollama) — used by the Command Room
# --------------------------------------------------------------------------- #
def suggest_prompt(theme, mock=False):
    theme = (theme or "").strip() or "late night study session"
    if mock:
        time.sleep(0.4)
        return (
            f"Chilled lo-fi hip-hop inspired by '{theme}', mellow Rhodes piano, "
            "dusty drums, soft vinyl crackle, rainy ambience, ~70 BPM, instrumental"
        )
    instruction = (
        "You are a lo-fi music producer. Turn the THEME into ONE concise Suno "
        "music-generation prompt on a single line: name the genre, mood, key "
        "instruments and tempo. No quotes, no preamble — output only the prompt.\n"
        f"THEME: {theme}"
    )
    payload = {
        "model": config.OLLAMA_MODEL,
        "prompt": instruction,
        "stream": False,
        "options": {"temperature": 0.8},
    }
    req = urllib.request.Request(
        f"{config.OLLAMA_URL}/api/generate",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        text = json.loads(r.read()).get("response", "").strip()
    return text.strip("\"'` ").replace("\n", " ")


# --------------------------------------------------------------------------- #
# Pipeline stages (thin wrappers over the npm scripts)
# --------------------------------------------------------------------------- #
def _mock_run(label, lines, on_line, delay=0.5):
    if on_line:
        on_line(f"[mock] {label}")
    for ln in lines:
        time.sleep(delay)
        if on_line:
            on_line(f"[mock] {ln}")
    return True


def generate(prompt, on_line=None, mock=False):
    if mock:
        return _mock_run("generate", ["Suno task submitted", "SUCCESS (2 tracks)", "stored to Airtable"], on_line)
    return run_npm("generate", ["--prompt", prompt or ""], on_line=on_line)


def render(on_line=None, mock=False):
    if mock:
        return _mock_run("render", ["artwork 1920x1080", "Ken Burns video encoded", "Video Ready"], on_line)
    return run_npm("render", on_line=on_line)


def ship(channels, on_line=None, mock=False):
    chans = ",".join(channels) if channels else "mock"
    if mock:
        return _mock_run("ship", [f"channels: {chans}", "posted -> https://mock/...", "Video Status: Uploaded"], on_line)
    return run_npm("ship", ["--channels", chans], on_line=on_line)


# --------------------------------------------------------------------------- #
# SNS caption preview (real Ollama, no posting) — for human review
# --------------------------------------------------------------------------- #
def preview_captions(prompt=None, channels=None, record=None, title=None):
    """Generate the SNS caption set without posting. Returns a dict (or {'error':...})."""
    cmd = [_node_exe(), "src/caption-preview.js"]
    if record:
        cmd += ["--record", record]
    if prompt:
        cmd += ["--prompt", prompt]
    if title:
        cmd += ["--title", title]
    if channels:
        cmd += ["--channels", ",".join(channels)]
    try:
        proc = subprocess.run(
            cmd, cwd=str(config.PROJECT_ROOT), env=_env(),
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
        )
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}
    out = (proc.stdout or "").strip()
    if not out:
        return {"error": (proc.stderr or "no output").strip()[:300]}
    try:
        return json.loads(out)
    except Exception:  # noqa: BLE001
        return {"error": f"bad JSON: {out[:200]}"}


def _emit_captions(caps, on_line):
    if not on_line or not caps:
        return
    if caps.get("error"):
        on_line(f"[文言プレビュー] 生成失敗: {caps['error']}")
        return
    v = caps.get("video", {})
    on_line("──── 📝 SNS文言プレビュー ────")
    on_line(f"[動画] タイトル: {v.get('title', '')}")
    on_line(f"[動画] 概要欄: {v.get('description', '')}")
    on_line(f"[動画] ハッシュタグ: {v.get('hashtags', '')}")
    on_line(f"[テキスト] 本文: {caps.get('text', {}).get('body', '')}")
    for key, ch in (caps.get("channels") or {}).items():
        on_line(f"[{key}] {(ch.get('body', '') or '').replace(chr(10), ' / ')}")
    on_line("────────────────────────────")


def run_pipeline(prompt, channels, on_step=None, on_line=None, mock=False,
                 do_generate=True, do_render=True, do_ship=True, on_captions=None):
    """The single reusable unit: generate -> render -> ship.
    A future infinite-loop auto button just calls this repeatedly."""
    if do_generate:
        if on_step:
            on_step("① 生成 (Suno)")
        if not generate(prompt, on_line, mock):
            return False
    if do_render:
        if on_step:
            on_step("② レンダリング (SD + 動画)")
        if not render(on_line, mock):
            return False
    if do_ship:
        # Always generate + surface the SNS text (mock or live) for human review.
        if on_step:
            on_step("✍️ SNS文言を生成中…")
        caps = preview_captions(prompt=prompt, channels=channels)
        if on_captions:
            on_captions(caps)
        _emit_captions(caps, on_line)
        if on_step:
            on_step(f"③ 出荷 ({', '.join(channels) or 'なし'})")
        if not ship(channels, on_line, mock):
            return False
    return True


# --------------------------------------------------------------------------- #
# Preview helpers (Factory Monitor)
# --------------------------------------------------------------------------- #
def _latest(folder: Path, exts):
    if not folder.exists():
        return None
    files = [p for p in folder.iterdir() if p.suffix.lower() in exts and not p.name.startswith("_")]
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime)


def latest_video():
    return _latest(config.VIDEO_DIR, {".mp4"})


def latest_artwork():
    return _latest(config.ARTWORK_DIR, {".png", ".jpg", ".jpeg"})


def services_health():
    """Quick reachability of Ollama + ComfyUI for the monitor."""
    health = {}
    for name, url in (("Ollama", f"{config.OLLAMA_URL}/api/tags"),
                      ("ComfyUI", "http://127.0.0.1:8188/system_stats")):
        try:
            urllib.request.urlopen(url, timeout=3)
            health[name] = True
        except Exception:
            health[name] = False
    return health
