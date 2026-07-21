# Dashboard Print / PDF Sample Layout Update

Updated the Dashboard Print and PDF export flow to generate the Executive Dashboard PDF in the Verara reference format.

## What changed

- Replaced the static/hardcoded dashboard PDF values with live HospAI data.
- Added a reusable `backend/utils/pdf_report_template.py` component with shared:
  - Verara header, title metadata, section heading, and bordered table helpers
  - light centered logo watermark
  - branded operator/signature footer
- Preserved the reference PDF ordering and visual structure:
  - Verara logo/address header with a full-width black divider
  - report title, print date, generator, and generated time
  - Dashboard Summary
  - Today's Operations
  - Revenue Snapshot
  - Payment Summary
- Added dynamic data aggregation for:
  - Today's patient registrations
  - OP queue waiting / in consultation / completed
  - Today's OP/IP operations
  - Lab tests and pending reports
  - Pharmacy pending bills
  - Today's revenue and outstanding amount
- Payment mode collections
- Kept backend endpoint `/api/dashboard/export/pdf` unchanged so existing frontend Print and Export / Share buttons continue to work.
- The exported PDF now uses the currently authenticated hospital context via `current_hospital_id()`.
- The export passes the logged-in operator's full name (or username) to the footer.

## Files updated

- `backend/app.py`
  - Uses the reusable template to populate live dashboard data.
  - Passes the current hospital ID and logged-in operator to the export renderer.
- `backend/utils/pdf_report_template.py`
  - Provides reusable common header, footer, watermark, metadata, table, and section heading primitives.
- `backend/tests/test_exports.py`
  - Verifies the authenticated dashboard PDF endpoint and core rendered sections.

## Validation

- Run `python -m pytest backend/tests/test_exports.py -q` in a configured HospAI Python environment to validate the endpoint and extracted report headings.
