# Dashboard Export Share Functionality Update

Implemented native export sharing for HospAI dashboard and reports.

## Frontend changes
- Added a reusable export helper in `frontend/src/lib/exportShare.ts`.
- Dashboard Export now opens the operating system/browser share sheet with the generated PDF attached when supported.
- Reports Center exports now use the same share flow for CSV, PDF, and Word/DOCX reports.
- Print still downloads the dashboard PDF directly.
- Export buttons are renamed to indicate share support.

## Sharing behavior
- Uses the browser Web Share API with file attachments where available.
- The OS decides which installed apps are shown, including Email, Outlook, Gmail, WhatsApp, Teams, Telegram, and other apps that register as share targets.
- When file sharing is unavailable, the file is downloaded and an email fallback is opened when the environment permits `mailto:` links.
- If users cancel the native share sheet, the app does not force a duplicate download.

## Backend/report-generation compatibility
- Existing `/api/dashboard/export/pdf` and `/api/reports/export/{csv,pdf,word}` endpoints are preserved.
- Existing report-generation functions and `Content-Disposition` download names remain compatible.
- Frontend now reads backend-provided filenames from `Content-Disposition`, with safe fallbacks.
