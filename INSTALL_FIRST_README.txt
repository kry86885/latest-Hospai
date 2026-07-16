HospAI install note:
If installer shows Retry, it means an old HospAI process is still running or locked by Windows.
This build auto-kills HospAI.exe and HospAI_Backend.exe before install.
If Windows still blocks, run this once before installer:

taskkill /F /IM HospAI.exe /T
taskkill /F /IM HospAI_Backend.exe /T

Then run release\HospAI_Setup.exe again.

A portable fallback is also generated:
release\HospAI_Portable.exe
