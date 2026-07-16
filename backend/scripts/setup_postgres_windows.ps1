param(
    [int]$Port = 5432,
    [string]$DbPassword = "1234",
    [string]$DbName = "hospaioffline",
    [string]$DbUser = "postgres"
)

$ErrorActionPreference = 'Stop'

function Fail($msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Fail "`psql` not found in PATH. Install Postgres and ensure psql is available."
}

# Use PGPASSWORD env var so psql doesn't prompt
$env:PGPASSWORD = $DbPassword

Write-Host "Checking connection to Postgres on port $Port..."
try {
    psql -U $DbUser -p $Port -h localhost -c "SELECT 1;" > $null 2>&1
} catch {
    Fail "Unable to connect to Postgres. Ensure Postgres is running and listening on localhost:$Port."
}
Write-Host "Connected to Postgres"

Write-Host "Ensuring database '$DbName' exists..."
$exists = psql -U $DbUser -p $Port -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName';"
if ($exists.Trim() -ne '1') {
    Write-Host "Creating database $DbName..."
    psql -U $DbUser -p $Port -h localhost -c "CREATE DATABASE \"$DbName\";"
} else {
    Write-Host "Database $DbName already exists"
}

# Update backend/.env DATABASE_URL
$envFile = Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath '.env'
if (-not (Test-Path $envFile)) {
    Write-Host "Creating backend/.env"
    "DATABASE_URL=postgresql://$DbUser:$DbPassword@localhost:$Port/$DbName" | Out-File -FilePath $envFile -Encoding utf8
} else {
    $content = Get-Content $envFile -Raw
    $newUrl = "DATABASE_URL=postgresql://$DbUser:$DbPassword@localhost:$Port/$DbName"
    if ($content -match "(?m)^DATABASE_URL=") {
        $content = $content -replace "(?m)^DATABASE_URL=.*$,", $newUrl
        # If above replace didn't match due to line ending, fallback to simpler replace
        if (-not ($content -match "(?m)^DATABASE_URL=.*$")) { $content = $newUrl + "`n" + $content }
    } else {
        $content = $content.TrimEnd() + "`n" + $newUrl + "`n"
    }
    $content | Out-File -FilePath $envFile -Encoding utf8
    Write-Host "Updated backend/.env with DATABASE_URL"
}

# Run database initializer
Write-Host "Running database initializer (run_init_database.py)"
$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) { Fail "`python` not found in PATH." }
$script = Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath "scripts/run_init_database.py"
if (-not (Test-Path $script)) { Fail "$script not found" }

try {
    & python $script
} catch {
    Fail "run_init_database.py failed: $_"
}

# Run tests
Write-Host "Running backend pytest..."
try {
    & python -m pytest -q ..\tests
} catch {
    Fail "pytest run failed: $_"
}

Write-Host "Done" -ForegroundColor Green
