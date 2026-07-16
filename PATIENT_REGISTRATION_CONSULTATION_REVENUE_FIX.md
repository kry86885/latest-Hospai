# Patient Registration Consultation Fee + Revenue Reflection Fix

## Fixed in this production package

1. Patient Registration / Appointment Intake
   - Consultation Fee is now mandatory before generating an OP token.
   - Fee must be greater than 0.
   - Payment Mode is sent with the appointment payload.

2. OP / Billing Revenue
   - New patient appointment consultation fee now creates an OP invoice automatically.
   - The consultation fee is immediately recorded as a payment.
   - Dashboard Today's Revenue now includes OP / Billing amount.
   - Dashboard revenue popup OP / Billing row now receives OP consultation payments.

3. Payment Collection Summary
   - Payment Mode Breakdown includes OP consultation fee payments.
   - Collections by Module displays OP invoices under OP / Billing.
   - Daily and Monthly payment summary date filters use actual payment dates.

4. Production validation
   - Backend rejects appointment creation if consultation fee is missing or 0.
   - Frontend production build verified with Vite.
   - Backend Python syntax verified.

## Verified commands

```bash
python3 -m py_compile backend/app.py backend/utils/database.py
cd frontend && npm run build
```
