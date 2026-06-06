# Block 2 — 工場モニター / Factory Monitor
# Status badge, service health, run log, and media previews.
import streamlit as st
import backend


def _render_captions():
    caps = st.session_state.get("captions")
    st.subheader("📝 SNS文言プレビュー")
    if not caps:
        st.caption("「✍️ SNS文言をプレビュー」または出荷を実行すると、生成された各SNS向けテキストがここに表示されます。")
        return
    if caps.get("error"):
        st.error(f"文言生成エラー: {caps['error']}")
        return

    v = caps.get("video", {})
    st.caption(f"生成元: {caps.get('via', '?')}")
    st.text_input("🎬 動画タイトル", value=v.get("title", ""), disabled=True, key="cap_title")
    st.text_area("📄 概要欄", value=v.get("description", ""), disabled=True, height=80, key="cap_desc")
    st.text_area("🏷️ ハッシュタグ", value=v.get("hashtags", ""), disabled=True, height=68, key="cap_tags")
    st.text_area("💬 テキスト投稿本文（X/Threads等）", value=caps.get("text", {}).get("body", ""),
                 disabled=True, height=68, key="cap_text")

    chans = caps.get("channels") or {}
    if chans:
        st.caption("各チャンネルの実際の投稿文言:")
        for key, ch in chans.items():
            link = "🔗リンク付き" if ch.get("includeLink") else "🚫リンク無し"
            with st.expander(f"{ch.get('label', key)}（{ch.get('captionStyle')} / {link}）"):
                if ch.get("title") and ch.get("captionStyle") == "video":
                    st.markdown(f"**タイトル:** {ch['title']}")
                st.code(ch.get("body", ""), language="text")


def render():
    st.header("🏭 2. 工場モニター / Factory Monitor")

    status = st.session_state.get("status", "待機中 (idle)")
    cols = st.columns([2, 1, 1])
    cols[0].metric("ステータス", status)

    health = backend.services_health()
    cols[1].metric("Ollama", "🟢 OK" if health.get("Ollama") else "🔴 停止")
    cols[2].metric("ComfyUI", "🟢 OK" if health.get("ComfyUI") else "🔴 停止")

    with st.expander("実行ログ", expanded=True):
        st.code(st.session_state.get("log", "(まだ実行していません)"), language="log")

    _render_captions()

    st.caption("最新の成果物プレビュー（更新は下のボタン or 実行後に反映）")
    if st.button("🔄 プレビュー更新"):
        st.rerun()

    c1, c2 = st.columns(2)
    with c1:
        st.caption("🎬 最新動画")
        video = backend.latest_video()
        if video:
            st.video(str(video))
            st.caption(video.name)
        else:
            st.info("動画はまだありません")
    with c2:
        st.caption("🖼️ 最新アートワーク")
        art = backend.latest_artwork()
        if art:
            st.image(str(art), width="stretch")
            st.caption(art.name)
        else:
            st.info("画像はまだありません")
