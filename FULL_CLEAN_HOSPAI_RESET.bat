@echo off
setlocal EnableExtensions
echo.
echo ===============================================================
echo  WARNING: FULL CLEAN RESET DELETES LICENSE, LOGIN AND LOCAL DB
echo ===============================================================
echo.
echo This is ONLY for pre-install/testing cleanup.
echo Do NOT run this after the hospital starts entering real patients.
echo Real hospital data is stored in PostgreSQL database hospai
echo.
set /p CONFIRM=Type DELETE to continue full clean reset: 
if /I not "%CONFIRM%"=="DELETE" (
  echo Cancelled. No data deleted.
  pause
  exit /b 0
)

echo Closing HospAI processes...
taskkill /F /IM HospAI.exe /T >nul 2>&1
taskkill /F /IM HospAI_Backend.exe /T >nul 2>&1

set BACKUP_DIR=%USERPROFILE%\Desktop\HospAI_PreClean_Backup_%DATE:/=-%_%TIME::=-%
set BACKUP_DIR=%BACKUP_DIR: =_%
if exist "%APPDATA%\HospAI" (
  echo Creating safety backup before delete: %BACKUP_DIR%
  mkdir "%BACKUP_DIR%" >nul 2>&1
  xcopy "%APPDATA%\HospAI" "%BACKUP_DIR%\HospAI" /E /I /H /Y >nul
)

echo Removing HospAI AppData, saved sessions, old licenses, caches and local DB...
rmdir /S /Q "%APPDATA%\HospAI" >nul 2>&1
rmdir /S /Q "%LOCALAPPDATA%\HospAI" >nul 2>&1
rmdir /S /Q "%APPDATA%\hospai" >nul 2>&1
rmdir /S /Q "%LOCALAPPDATA%\hospai" >nul 2>&1
rmdir /S /Q "%APPDATA%\HospAI Desktop" >nul 2>&1
rmdir /S /Q "%LOCALAPPDATA%\HospAI Desktop" >nul 2>&1

echo.
echo Clean reset completed.
echo If a previous data folder existed, backup was created on Desktop.
echo Open HospAI again. It must show the license activation page first.
echo.
pause
