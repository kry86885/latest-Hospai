HospAI final improvement build

Completed in this ZIP:
1. Patient Registration improvements kept intact.
2. SymptoMap AI removed.
3. OCR DOB/Age button removed from registration.
4. Appointment In enhanced.
5. Consent Desk enhanced with existing patient auto-fill.
6. Insurance Desk enhanced with patient lookup, auto-fill, TPA, pre-auth, approved amount, document reference, status and history.
7. Appointment Out queue supports completing/cancelling visits.
8. OP Desk remains available for doctor schedules and OP appointments.
9. Doctor Prescription module added.
10. IP Admission module added.
11. Nurse Station module added.
12. Discharge Summary module added.
13. Existing Billing, Lab, Pharmacy, Reports and admin modules preserved.

Verification:
- Frontend production build passed with npm run build.

Run commands:
Backend:
cd backend
pip install -r requirements.txt
python app.py

Frontend, in another terminal:
cd frontend
npm install
npm run dev
