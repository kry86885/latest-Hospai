@echo off
echo This removes local HospAI AppData for fresh testing on THIS PC only.
echo Do not run this on a client PC with real data unless you want to delete it.
pause
rmdir /s /q "%APPDATA%\HospAI"
echo Done. Reinstall/open HospAI to copy the clean bundled database.
pause
