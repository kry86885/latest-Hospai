# Payment Collection Autofill + Summary Update

Updated in this package:

1. Payment Collection > Record Payment now auto-fills patient details when Patient ID / UHID is entered.
2. Patient Name is filled from the patient master record.
3. If the patient has an existing pending invoice/due, the form auto-selects it and fills:
   - Invoice
   - Due Payment For
   - Due Amount Paying
4. If an existing invoice is selected, Record Payment now applies payment to that invoice instead of creating a duplicate direct payment.
5. If no invoice is selected, Record Payment still creates a direct payment entry.
6. Payment Summary refreshes immediately after payment save, so existing records and new/future payments are reflected in totals and payment-mode summary.
7. Frontend production build was regenerated in `frontend/dist`.

Tested:
- Frontend build completed successfully with Vite.
- Backend Python syntax compile passed for app.py and database.py.
