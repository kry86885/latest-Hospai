@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."
set "BACKUP_DIR=%ROOT_DIR%\backups"
set "PG_DUMP=C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
if not defined PGCONNECT_TIMEOUT set "PGCONNECT_TIMEOUT=10"
if not exist "%PG_DUMP%" (
  echo [FAIL] pg_dump not found: %PG_DUMP%
  exit /b 1
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "STAMP=%%i"
set "BACKUP_FILE=%BACKUP_DIR%\hospai_backup_%STAMP%.sql"

"%PG_DUMP%" -h 127.0.0.1 -p 5432 -U postgres -d hospai -F p -f "%BACKUP_FILE%"
if errorlevel 1 (
  echo [FAIL] Backup failed. pg_dump may need a password or PGPASSWORD.
  exit /b 1
)
echo [PASS] Backup created: %BACKUP_FILE%
