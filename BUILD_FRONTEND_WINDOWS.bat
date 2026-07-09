@echo off
setlocal
cd /d "%~dp0frontend"
if not exist node_modules (
  npm ci
)
npm run build
pause
