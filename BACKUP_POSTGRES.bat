@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ==========================================
echo HospAI PostgreSQL Backup Utility
echo ==========================================
echo.

if not exist .env (
    echo [!] Error: .env file not found in project root!
    pause
    exit /b 1
)

:: Parse DATABASE_URL from .env
set DB_URL=
for /f "usebackq tokens=1,2* delims==" %%i in (".env") do (
    set "key=%%i"
    set "val=%%j"
    :: Strip leading/trailing spaces and quotes
    set "key=!key: =!"
    if "!key!"=="DATABASE_URL" (
        set "DB_URL=%%j"
        :: Strip quotes if any
        set "DB_URL=!DB_URL:"=!"
    )
)

if "!DB_URL!"=="" (
    echo [!] Error: DATABASE_URL not found or empty in .env.
    echo Please make sure DATABASE_URL is configured for PostgreSQL.
    pause
    exit /b 1
)

:: Prepare backup directory on Desktop
set BACKUP_DIR=%USERPROFILE%\Desktop\HospAI_PG_Backup_%DATE:/=-%_%TIME::=-%
set BACKUP_DIR=%BACKUP_DIR: =_%
set BACKUP_DIR=%BACKUP_DIR::=-%

echo [*] Creating backup directory at: %BACKUP_DIR%
mkdir "%BACKUP_DIR%" >nul 2>&1

:: Run pg_dump
echo [*] Dumping PostgreSQL database...
pg_dump "%DB_URL%" -F c -b -v -f "%BACKUP_DIR%\hospai.backup"
if errorlevel 1 (
    echo [!] Warning: pg_dump execution failed or command not found in system PATH.
    echo If PostgreSQL bin folder is not on your PATH, we will try default installation paths...
    
    :: Try default install locations
    set "PG_DUMP_PATH="
    for /d %%d in ("C:\Program Files\PostgreSQL\*") do (
        if exist "%%d\bin\pg_dump.exe" (
            set "PG_DUMP_PATH=%%d\bin\pg_dump.exe"
        )
    )
    
    if defined PG_DUMP_PATH (
        echo [*] Found pg_dump at: "!PG_DUMP_PATH!"
        "!PG_DUMP_PATH!" "%DB_URL%" -F c -b -v -f "%BACKUP_DIR%\hospai.backup"
    ) else (
        echo [!] Error: pg_dump not found in system PATH or default PostgreSQL installations.
        echo Please ensure PostgreSQL tools are installed and added to your system PATH.
        pause
        exit /b 1
    )
)

:: Backup uploads folder if exists
if exist backend\uploads (
    echo [*] Backing up local media uploads...
    mkdir "%BACKUP_DIR%\uploads" >nul 2>&1
    xcopy "backend\uploads" "%BACKUP_DIR%\uploads" /E /I /H /Y >nul
)

echo.
echo ==========================================
echo [+] Backup Completed Successfully!
echo ==========================================
echo Database backup: %BACKUP_DIR%\hospai.backup
if exist "%BACKUP_DIR%\uploads" echo Uploads backup:  %BACKUP_DIR%\uploads
echo.
pause
