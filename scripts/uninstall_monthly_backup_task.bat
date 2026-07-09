@echo off
schtasks /Delete /TN "HospAI-Monthly-Backup" /F
if errorlevel 1 (
  echo [FAIL] Could not remove HospAI-Monthly-Backup or it was not installed.
  exit /b 1
)
echo [PASS] HospAI-Monthly-Backup task removed.
