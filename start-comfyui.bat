@echo off
REM ============================================================
REM  Launch the ComfyUI headless API server for lofi-studio.
REM  Required by Phase 2.5 (local Stable Diffusion artwork)
REM  whenever ARTWORK_SOURCE=local-sd.
REM  Leave this window open while running `npm run render`.
REM ============================================================
echo Starting ComfyUI on http://127.0.0.1:8188 ...
"%USERPROFILE%\ComfyUI\.venv\Scripts\python.exe" "%USERPROFILE%\ComfyUI\main.py" --listen 127.0.0.1 --port 8188
pause
