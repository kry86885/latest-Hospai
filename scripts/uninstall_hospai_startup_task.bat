@echo off
schtasks /Delete /TN "HospAI-Server" /F
if errorlevel 1 (
  echo [FAIL] Could not remove HospAI-Server or it was not installed.
  exit /b 1
)
echo [PASS] HospAI-Server startup task removed.
