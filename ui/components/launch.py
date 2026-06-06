# Block 3 — 発射ボタン / Launch
# Channel selection + the big "一斉出荷" button (runs generate -> render -> ship).
import streamlit as st
import backend
import config


def _execute(prompt, channels, mock, steps):
    st.session_state["status"] = "実行中… (running)"
    lines = []
    box = st.status("パイプライン実行中…", expanded=True)
    log_area = box.empty()

    def on_step(msg):
        box.update(label=msg)
        st.session_state["status"] = msg

    def on_line(line):
        lines.append(line)
        log_area.code("\n".join(lines[-60:]), language="log")

    ok = backend.run_pipeline(
        prompt, channels,
        on_step=on_step, on_line=on_line, mock=mock,
        do_generate=steps["gen"], do_render=steps["render"], do_ship=steps["ship"],
        on_captions=lambda c: st.session_state.__setitem__("captions", c),
    )
    box.update(label="✅ 完了 (done)" if ok else "❌ エラー (error)",
               state="complete" if ok else "error")
    st.session_state["log"] = "\n".join(lines)
    st.session_state["status"] = "完了 (done)" if ok else "エラー (error)"
    return ok


def render(prompt, mock=False):
    st.header("🚀 3. 発射ボタン / Launch")

    st.caption("出荷先チャンネル")
    selected = []
    cols = st.columns(4)
    for i, ch in enumerate(config.CHANNELS):
        badge = config.STATUS_BADGE.get(ch["status"], "")
        with cols[i % 4]:
            checked = st.checkbox(
                f"{ch['label']} {badge}",
                value=(ch["key"] == "youtube"),
                key=f"ch_{ch['key']}",
                help="準備中チャンネルは選択すると 'blocked' として安全にスキップされます"
                if ch["status"] == "scaffold" else None,
            )
            if checked:
                selected.append(ch["key"])

    # Which pipeline stages to run (lets the big button do full or partial runs).
    st.caption("実行する工程")
    sc = st.columns(3)
    steps = {
        "gen": sc[0].checkbox("① 生成", value=True, key="step_gen"),
        "render": sc[1].checkbox("② レンダリング", value=True, key="step_render"),
        "ship": sc[2].checkbox("③ 出荷", value=True, key="step_ship"),
    }

    # Review the generated SNS text before any real run (Ollama, no posting).
    if st.button("✍️ SNS文言をプレビュー（投稿なし）", width="stretch"):
        with st.spinner("Ollama で文言生成中…"):
            st.session_state["captions"] = backend.preview_captions(prompt=prompt, channels=selected)
        st.toast("SNS文言を生成しました → 工場モニターで確認")

    disabled = steps["gen"] and not (prompt or "").strip()
    if disabled:
        st.warning("① 生成にはプロンプトが必要です（指令室で入力してください）")

    if st.button("🚀 連携SNSへ一斉出荷！", type="primary", width="stretch", disabled=disabled):
        _execute(prompt, selected, mock, steps)

    # --- Extension seam: future "infinite-loop full-auto" mode -------------- #
    with st.expander("🔁 完全自動運転モード（近日実装）"):
        st.checkbox("指定間隔で無限ループ実行", value=False, disabled=True,
                    help="将来ここに interval 実行を追加。backend.run_pipeline() を while ループで呼ぶだけで実装できます。")
        st.number_input("実行間隔（分）", value=60, disabled=True)
