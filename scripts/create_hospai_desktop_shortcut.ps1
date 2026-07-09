$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendEnv = Join-Path (Split-Path -Parent $ScriptDir) "backend\.env"
$ServerIp = "127.0.0.1"
$Port = "5001"

if (Test-Path $BackendEnv) {
  Get-Content $BackendEnv | ForEach-Object {
    if ($_ -match '^HOSPAI_SERVER_IP=(.+)$') { $ServerIp = $Matches[1].Trim() }
    if ($_ -match '^FLASK_PORT=(.+)$') { $Port = $Matches[1].Trim() }
  }
}

$TargetUrl = "http://$ServerIp`:$Port"
$ShortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "HospAI.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetUrl
$Shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
$Shortcut.Save()
Write-Host "[PASS] HospAI desktop shortcut created: $ShortcutPath"
