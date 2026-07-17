@echo off
title HospAI Launcher
echo ===================================================
echo             HospAI Smart Management System
echo ===================================================
echo.
echo [+] Detecting Local Network IP Address...
set LOCAL_IP=
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress | Where-Object { $_.AddressState -eq 'Preferred' -and $_.ValidLifetime -lt [TimeSpan]::MaxValue -and $_.AddressFamily -eq 'IPv4' -and $_.IPAddress -ne '127.0.0.1' }).IPAddress | Select-Object -First 1"`) do set LOCAL_IP=%%i
if "%LOCAL_IP%"=="" (
  for /f "tokens=4" %%a in ('route print ^| findstr "\<0.0.0.0\>"') do set LOCAL_IP=%%a
)
if "%LOCAL_IP%"=="" set LOCAL_IP=localhost

echo [+] Detected IP: %LOCAL_IP%
echo.
echo [+] Launching Backend API in a new window...
start "HospAI Backend Server" cmd /c "%~dp0START_BACKEND_WINDOWS.bat"

echo.
echo [+] Launching Frontend Dev Server in a new window...
start "HospAI Frontend Server" cmd /c "%~dp0START_FRONTEND_WINDOWS.bat"

echo.
echo ===================================================
echo Launching complete!
echo.
echo Please verify the application using the following URLs:
echo.
echo 1. Local Machine:
echo    - Frontend: http://localhost:5173
echo    - Backend Health: http://localhost:5001/api/health
echo.
echo 2. Local Network (Mobile, Tablet, other PCs):
echo    - Frontend: http://%LOCAL_IP%:5173
echo    - Backend Health: http://%LOCAL_IP%:5001/api/health
echo ===================================================
echo.
pause
