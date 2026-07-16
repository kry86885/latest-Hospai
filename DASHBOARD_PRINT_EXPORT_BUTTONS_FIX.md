# Dashboard Print and Export Buttons Fix

## Updated behavior

- Dashboard Print button now fetches the live executive dashboard PDF and opens the browser print dialog through a hidden PDF iframe.
- If the browser blocks print preview, the PDF is downloaded as a fallback.
- Dashboard Export / Share button now fetches the same live PDF and uses the native OS/browser share sheet where available.
- If native file sharing is unavailable, the PDF downloads and the existing email fallback opens where supported.
- Print and Export have independent loading states, so users can clearly see which action is preparing.

## Backend updates

- `/api/dashboard/export/pdf` now requires only an authenticated session, so dashboard users are not blocked by an unrelated module permission.
- Added `Content-Disposition`, `Access-Control-Expose-Headers`, and `Cache-Control` headers so the frontend can correctly read the PDF filename and avoid stale reports.
- Added backward-compatible `/api/dashboard/print/pdf` endpoint for clients that use a dedicated print URL.

## Validation

- Frontend production build completed successfully with `npm run build`.
- Backend syntax check completed successfully with `python3 -m py_compile backend/app.py`.
