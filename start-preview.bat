@echo off
cd /d "%~dp0"
set NODE_OPTIONS=
echo Starting TeamLaunch preview on http://127.0.0.1:5180
echo Keep this window open. Close it to stop the preview.
npx vite --port 5180 --strictPort
if errorlevel 1 pause
