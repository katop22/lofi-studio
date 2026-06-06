# Block 1 — 指令室 / Command Room
# Theme input + AI-suggested prompt that the operator can hand-edit.
import streamlit as st
import backend


def render(mock=False):
    st.header("🛰️ 1. 指令室 / Command Room")

    st.text_area(
        "メインテーマ",
        key="theme",
        placeholder="例: 雨の夜の渋谷、終電後の静けさ、勉強用のチル…",
        height=80,
    )

    if st.button("🤖 AIでプロンプト生成", width="stretch"):
        try:
            with st.spinner("Ollama が思考中…"):
                st.session_state["prompt_text"] = backend.suggest_prompt(
                    st.session_state.get("theme", ""), mock=mock
                )
        except Exception as e:  # noqa: BLE001
            st.error(f"プロンプト生成に失敗: {e}")

    # Editable prompt box — operator can freely tweak the AI output before launch.
    prompt = st.text_area(
        "生成プロンプト（手動修正可）",
        key="prompt_text",
        placeholder="ここに最終的な音楽生成プロンプトを入れます（AI生成→手直しOK）",
        height=120,
    )
    return prompt
