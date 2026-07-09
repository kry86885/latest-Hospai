# Dashboard Print / PDF Sample Layout Update

Updated the Dashboard Print and PDF export flow to generate the Executive Dashboard PDF in the same professional structure as the provided `dashboard.pdf` sample.

## What changed

- Replaced the static/hardcoded dashboard PDF values with live HospAI data.
- Preserved the sample PDF ordering and visual structure:
  - Hospital header and dashboard title
  - Print date
  - Dashboard Summary
  - Today's Operations
  - Revenue Snapshot
  - Payment Summary
  - OP Queue and Bed Status
  - Alerts & Notifications
  - AI Insights
- Added dynamic data aggregation for:
  - Today's patient registrations
  - OP queue waiting / in consultation / completed
  - Today's OP/IP operations
  - Lab tests and pending reports
  - Pharmacy pending bills
  - Today's revenue and outstanding amount
  - Payment mode collections
  - Bed occupancy
  - Alerts and AI insight text
- Kept backend endpoint `/api/dashboard/export/pdf` unchanged so existing frontend Print and Export / Share buttons continue to work.
- The exported PDF now uses the currently authenticated hospital context via `current_hospital_id()`.

## Files updated

- `backend/app.py`
  - Added dashboard PDF data aggregation helper.
  - Updated `generate_executive_dashboard_pdf()` to populate live values into the sample layout.
  - Updated `/api/dashboard/export/pdf` to pass the current hospital ID.

## Validation

- Python syntax validation passed using `python -m py_compile backend/app.py`.
- Full runtime PDF rendering could not be executed in this container because Flask is not installed in the execution environment, but the updated source is syntax-valid and the existing endpoint contract is preserved.
