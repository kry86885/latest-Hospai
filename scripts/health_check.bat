@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "BACKEND_ENV=%SCRIPT_DIR%..\backend\.env"
set "APP_HOST=127.0.0.1"
set "APP_PORT=5001"
if exist "%BACKEND_ENV%" (
  for /f "tokens=1,* delims==" %%A in ('findstr /b "HOSPAI_SERVER_IP= FLASK_PORT=" "%BACKEND_ENV%"') do (
    if /I "%%A"=="HOSPAI_SERVER_IP" set "APP_HOST=%%B"
    if /I "%%A"=="FLASK_PORT" set "APP_PORT=%%B"
  )
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=New-Object Net.Sockets.TcpClient; $a=$c.BeginConnect('127.0.0.1',5432,$null,$null); if ($a.AsyncWaitHandle.WaitOne(3000) -and $c.Connected) { $c.EndConnect($a); $c.Close(); exit 0 } $c.Close(); exit 1"
if errorlevel 1 (echo [FAIL] PostgreSQL port 5432) else (echo [PASS] PostgreSQL port 5432)
curl.exe --noproxy "*" --fail --silent --show-error --max-time 10 "http://%APP_HOST%:%APP_PORT%/api/health" >nul
if errorlevel 1 (echo [FAIL] HospAI URL http://%APP_HOST%:%APP_PORT%) else (echo [PASS] HospAI URL http://%APP_HOST%:%APP_PORT%)
