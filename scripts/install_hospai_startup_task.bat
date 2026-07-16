@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "TASK_NAME=HospAI-Server"
set "START_SCRIPT=%SCRIPT_DIR%start_hospai_server.bat"

schtasks /Create /TN "%TASK_NAME%" /TR "\"%START_SCRIPT%\"" /SC ONLOGON /RL HIGHEST /F
if errorlevel 1 (
  echo [WARN] Could not create %TASK_NAME% with highest privileges. Trying current-user privileges...
  schtasks /Create /TN "%TASK_NAME%" /TR "\"%START_SCRIPT%\"" /SC ONLOGON /F
  if errorlevel 1 (
    echo [WARN] Could not create %TASK_NAME% through Task Scheduler. Creating Startup folder shortcut instead...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$startup=[Environment]::GetFolderPath('Startup'); $path=Join-Path $startup 'HospAI-Server.lnk'; $shell=New-Object -ComObject WScript.Shell; $shortcut=$shell.CreateShortcut($path); $shortcut.TargetPath='%START_SCRIPT%'; $shortcut.WorkingDirectory='%SCRIPT_DIR%..'; $shortcut.WindowStyle=7; $shortcut.Save(); Write-Host ('[PASS] Startup shortcut created: ' + $path)"
    if errorlevel 1 (
      echo [FAIL] Could not create startup automation. Run this script as Administrator.
      exit /b 1
    )
    exit /b 0
  )
  echo [PASS] %TASK_NAME% startup task installed with current-user privileges.
  exit /b 0
)
echo [PASS] %TASK_NAME% startup task installed.
