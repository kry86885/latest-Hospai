@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "TASK_NAME=HospAI-Monthly-Backup"
set "BACKUP_SCRIPT=%SCRIPT_DIR%backup_postgres.bat"

schtasks /Create /TN "%TASK_NAME%" /TR "\"%BACKUP_SCRIPT%\"" /SC MONTHLY /D 1 /ST 10:00 /RL HIGHEST /F
if errorlevel 1 (
  echo [WARN] Could not create %TASK_NAME% with highest privileges. Trying current-user privileges...
  schtasks /Create /TN "%TASK_NAME%" /TR "\"%BACKUP_SCRIPT%\"" /SC MONTHLY /D 1 /ST 10:00 /F
  if errorlevel 1 (
    echo [FAIL] Could not create %TASK_NAME%. Run this script as Administrator.
    exit /b 1
  )
  echo [PASS] %TASK_NAME% monthly backup task installed with current-user privileges.
  exit /b 0
)
echo [PASS] %TASK_NAME% monthly backup task installed.
