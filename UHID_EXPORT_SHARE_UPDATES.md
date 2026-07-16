# UHID and Dashboard Export Share Updates

## UHID generation
- Updated `backend/utils/database.py` so new UHIDs keep the existing `PAT-YYYYMMDD-NNNN` pattern while using day-based numeric blocks:
  - Day 1: `PAT-YYYYMMDD-1001`
  - Day 2: `PAT-YYYYMMDD-2001`
  - Day 3: `PAT-YYYYMMDD-3001`
- Existing legacy records such as `PAT-YYYYMMDD-0001` are preserved and are not modified.
- Patient lookup now supports:
  - Full UHID, e.g. `PAT-20260616-1001`
  - Numeric suffix only, e.g. `1001`, `2001`, `3001`
- Search stays backward compatible with older UHIDs and current database records.

## Dashboard export sharing
- Added `frontend/src/lib/exportShare.ts` with a cross-platform export sharing helper.
- Dashboard Export now opens the native OS/device share sheet when supported, allowing sharing through available apps such as Email, Outlook, Gmail, WhatsApp, Teams, Telegram, etc.
- If native sharing is unavailable, the PDF downloads normally and opens an email-compose fallback with sharing instructions.
- Print still downloads the dashboard PDF directly.

## Validation performed
- Frontend production build completed successfully with `npm run build`.
- Backend Python syntax check completed successfully with `python -m py_compile backend/utils/database.py backend/app.py`.

Note: The local pytest run could not complete because the active Python environment is missing the `bcrypt` dependency. The source code syntax validation passed.
