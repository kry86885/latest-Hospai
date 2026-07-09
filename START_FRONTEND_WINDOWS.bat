@echo off
setlocal
cd /d "%~dp0frontend"
if not exist node_modules (
  npm ci
)
npm run dev -- --host 0.0.0.0 --port 5173
pause
