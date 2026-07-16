# Payment Summary Calendar Fix

Implemented production update for Payment Collection > Payment Summary.

## Fixed
- Calendar date switching now reloads payment summary for the selected date.
- Monthly switching now reloads payment summary for the selected month.
- Payment mode rows now use actual payment collection dates from invoice payments, diagnostics, and pharmacy sales.
- After recording a payment, the selected date/month summary refreshes immediately.
- Existing saved payments and further new payments are reflected in the selected calendar period.

## Technical Notes
- `/api/billing/revenue-summary` now supports:
  - `?date=YYYY-MM-DD`
  - `?month=YYYY-MM`
- Frontend Payment Summary uses the selected-period API response instead of the global revenue summary.
- Production frontend build verified with `npm run build`.
- Backend syntax verified with `python -m py_compile backend/app.py backend/utils/database.py`.
