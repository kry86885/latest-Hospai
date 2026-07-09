@echo off
setlocal
if "%~1"=="" (
  echo Usage: restore_postgres.bat path\to\backup.sql
  exit /b 1
)
set /p CONFIRM=This will restore into PostgreSQL database hospai. Type RESTORE to continue: 
if /I not "%CONFIRM%"=="RESTORE" (
  echo Restore cancelled.
  exit /b 1
)
"C:\Program Files\PostgreSQL\17\bin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d hospai -f "%~1"
exit /b %ERRORLEVEL%
