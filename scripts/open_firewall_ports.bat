@echo off
netsh advfirewall firewall delete rule name="HospAI Backend 5001" >nul 2>nul
netsh advfirewall firewall add rule name="HospAI Backend 5001" dir=in action=allow protocol=TCP localport=5001 >nul
netsh advfirewall firewall delete rule name="HospAI PostgreSQL 5432" >nul 2>nul
netsh advfirewall firewall add rule name="HospAI PostgreSQL 5432" dir=in action=allow protocol=TCP localport=5432 >nul
if errorlevel 1 (
  echo [FAIL] Could not add one or more firewall rules. Run as Administrator.
  exit /b 1
)
echo [PASS] Firewall rules for TCP 5001 and TCP 5432 are present.
