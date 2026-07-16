@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."
set "BACKEND_DIR=%ROOT_DIR%\backend"
set "LOG_DIR=%ROOT_DIR%\logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "STAMP=%%i"
set "LOG_FILE=%LOG_DIR%\hospai_backend_%STAMP%.log"
cd /d "%BACKEND_DIR%" || exit /b 1

set "PYTHON_EXE=python"
if "%HOSPAI_USE_BACKEND_VENV%"=="1" (
  if exist "%BACKEND_DIR%\backend.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%BACKEND_DIR%\backend.venv\Scripts\python.exe"
  ) else if exist "%BACKEND_DIR%\.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%BACKEND_DIR%\.venv\Scripts\python.exe"
  )
)

"%PYTHON_EXE%" --version >nul 2>&1
if errorlevel 1 set "PYTHON_EXE=python"

echo [%date% %time%] Starting HospAI backend...>> "%LOG_FILE%"
set "PYTHONUNBUFFERED=1"
"%PYTHON_EXE%" app.py >> "%LOG_FILE%" 2>&1
exit /b %ERRORLEVEL%
