# PDF OP Management & Billing Dashboard Update

Updated according to `HOSP_AI_OP_Management_Billing_Module.pdf`.

## Main updates
- Sidebar now follows the PDF module flow:
  - Overview Module
  - OP Management Module
  - Billing Module
- Removed unrelated sidebar modules from the active navigation.
- Dashboard KPI card `Today's Registrations` now opens a popup instead of redirecting.
- Popup shows selected date / today's patient registrations from live patient data.
- Every patient row in the popup has a `View` button.
- `View` opens a patient details popup with UHID, admission ID, age/gender, DOB, phone, address, symptoms, allergies, emergency contact, and registration time.
- Dashboard auto-refreshes every 30 seconds while open.
- Quick Actions and Today's Operations now match the PDF process flow:
  Patient Registration → Queue Management → Doctor Consultation → Billing → Payment Collection → Revenue Reporting → Doctor Payout.

## Verification
- Frontend production build was tested successfully with:
  `PUPPETEER_SKIP_DOWNLOAD=1 npm install && npm run build`
- Backend Python files compile successfully with:
  `python -m py_compile backend/app.py backend/utils/database.py`
