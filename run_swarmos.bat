@echo off
cd /d "%~dp0"
start "" cmd /c "timeout /t 2 >nul & start http://localhost:5173"
python server.py
pause
