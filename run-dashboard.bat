@echo off
REM ============================================================
REM  Launch the lofi-studio operator dashboard (Streamlit).
REM  First run auto-creates a venv and installs Streamlit.
REM ============================================================
cd /d "%~dp0"
set VENV=ui\.venv
if not exist "%VENV%\Scripts\streamlit.exe" (
  echo [setup] creating dashboard venv + installing Streamlit ...
  "%USERPROFILE%\tools\uv\uv.exe" venv "%VENV%" --python 3.11
  "%USERPROFILE%\tools\uv\uv.exe" pip install --python "%VENV%\Scripts\python.exe" -r ui\requirements.txt
)
echo [run] starting dashboard on http://localhost:8501 ...
"%VENV%\Scripts\streamlit.exe" run ui\app.py
pause
