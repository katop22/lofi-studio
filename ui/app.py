# lofi-studio — operator dashboard (Streamlit).
# Drives the Node pipeline (generate -> render -> ship) via backend.py.
# Run:  streamlit run ui/app.py     (or use run-dashboard.bat)
import streamlit as st

from components import command_room, factory_monitor, launch

st.set_page_config(page_title="lofi-studio 指令室", page_icon="🎧", layout="wide")

# --- Session defaults ------------------------------------------------------- #
st.session_state.setdefault("status", "待機中 (idle)")
st.session_state.setdefault("log", "")
st.session_state.setdefault("prompt_text", "")

# --- Sidebar ---------------------------------------------------------------- #
with st.sidebar:
    st.title("🎧 lofi-studio")
    st.caption("自動生成・出荷ダッシュボード")
    mock = st.toggle(
        "🧪 モックモード",
        value=True,
        help="ON: 実行を擬似シミュレート（Suno/YouTube課金なし）。OFF: 実際に npm パイプラインを実行。",
    )
    st.divider()
    st.write("**モード:**", "🧪 Mock" if mock else "🔴 LIVE")
    st.caption(
        "LIVEは実際に Suno生成・ComfyUIレンダ・YouTube出荷を行います。"
        "ComfyUI/Ollama が起動している必要があります。"
    )

st.title("🎛️ lofi-studio コントロールセンター")
if mock:
    st.info("🧪 モックモード中：ボタンは擬似実行です。実運用するにはサイドバーでOFFに。", icon="🧪")

# --- Layout: Command Room + Launch (left) | Factory Monitor (right) --------- #
left, right = st.columns([1, 1], gap="large")

with left:
    prompt = command_room.render(mock=mock)
    st.divider()
    launch.render(prompt, mock=mock)

with right:
    factory_monitor.render()
