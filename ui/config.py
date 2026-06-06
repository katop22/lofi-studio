# Dashboard configuration — paths to the Node project + channel metadata.
from pathlib import Path

# ui/ lives inside the project; the Node pipeline runs from the project root.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output"
VIDEO_DIR = OUTPUT_DIR / "video"
ARTWORK_DIR = OUTPUT_DIR / "artwork"

# Toolchain locations (portable Node + corporate CA bundle from earlier phases).
NODE_DIR = Path.home() / "tools" / "node-v22.16.0-win-x64"
CA_BUNDLE = Path.home() / "tools" / "win-ca-bundle.pem"

OLLAMA_URL = "http://localhost:11434"
OLLAMA_MODEL = "dolphin-llama3:latest"

# Distribution channels shown in the launch panel.
# status: "live" (wired), "scaffold" (awaiting API wiring), "test" (mock).
CHANNELS = [
    {"key": "youtube", "label": "YouTube", "status": "live"},
    {"key": "x", "label": "X", "status": "live"},
    {"key": "tiktok", "label": "TikTok", "status": "scaffold"},
    {"key": "instagram", "label": "Instagram", "status": "scaffold"},
    {"key": "threads", "label": "Threads", "status": "scaffold"},
    {"key": "reddit", "label": "Reddit", "status": "scaffold"},
    {"key": "pinterest", "label": "Pinterest", "status": "scaffold"},
    {"key": "mock", "label": "Mock (test)", "status": "test"},
]

STATUS_BADGE = {
    "live": "🟢 LIVE",
    "scaffold": "🟡 準備中",
    "test": "🧪 TEST",
}
