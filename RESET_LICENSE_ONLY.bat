@echo off
setlocal EnableExtensions
echo Closing HospAI...
taskkill /F /IM HospAI.exe /T >nul 2>&1
taskkill /F /IM HospAI_Backend.exe /T >nul 2>&1

echo Removing only license files. Patient/database data will NOT be deleted.
rmdir /S /Q "%APPDATA%\HospAI\licenses" >nul 2>&1

echo License reset completed. HospAI should ask for activation again.
echo Data remains in PostgreSQL database hospai
pause
