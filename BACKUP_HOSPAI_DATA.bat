@echo off
setlocal EnableExtensions
set BACKUP_DIR=%USERPROFILE%\Desktop\HospAI_Backup_%DATE:/=-%_%TIME::=-%
set BACKUP_DIR=%BACKUP_DIR: =_%
echo Closing HospAI before backup...
taskkill /F /IM HospAI.exe /T >nul 2>&1
taskkill /F /IM HospAI_Backend.exe /T >nul 2>&1
if not exist "%APPDATA%\HospAI" (
  echo No HospAI AppData found at %APPDATA%\HospAI
  pause
  exit /b 1
)
echo Creating backup: %BACKUP_DIR%
mkdir "%BACKUP_DIR%" >nul 2>&1
xcopy "%APPDATA%\HospAI" "%BACKUP_DIR%\HospAI" /E /I /H /Y >nul
if errorlevel 1 (
  echo Backup failed.
  pause
  exit /b 1
)
echo Backup completed successfully.
echo Data copied from: %APPDATA%\HospAI
echo Data backup: %BACKUP_DIR%\HospAI
pause
