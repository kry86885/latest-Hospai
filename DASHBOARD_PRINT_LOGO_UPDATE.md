# Dashboard Print PDF Logo Update

Updated the Dashboard print/export PDF generation so the report keeps the uploaded executive dashboard PDF structure and includes the HospAI/Keppler hospital logo at the top-left corner of the first page.

## Files updated

- `backend/app.py`

## What changed

- Added `_dashboard_report_logo_path()` to resolve the hospital logo safely across offline/backend launch paths.
- Added top-left logo rendering inside `generate_executive_dashboard_pdf()`.
- Kept the existing Dashboard Summary, Today's Operations, Revenue Snapshot, Payment Summary, OP Queue and Bed Status, Alerts & Notifications, and AI Insights ordering.
- Kept the same `/api/dashboard/export/pdf` and `/api/dashboard/print/pdf` endpoints used by Dashboard Print/Export buttons.
- Logo rendering is defensive: if the logo file is missing or cannot render, PDF generation still works instead of crashing.

## Validation

- `python3 -m py_compile backend/app.py` passed.
- Frontend build was not rerun because `frontend/node_modules` is not included in this uploaded ZIP/environment; no frontend source change was required for this update.
