@echo off
title HospAI Launcher
echo ===================================================
echo             HospAI Smart Management System
echo ===================================================
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
echo    - Frontend: http://192.168.0.102:5173
echo    - Backend Health: http://192.168.0.102:5001/api/health
echo ===================================================
echo.
pause
