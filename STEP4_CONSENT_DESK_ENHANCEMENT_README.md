# Step 4 - Consent Desk Enhancement

Updated only the Consent Desk workflow while keeping previous Patient Registration, OCR cleanup, SymptoMap removal, and Appointment In changes intact.

## Added
- Patient lookup by UHID / mobile / Aadhaar / name.
- Auto-fill patient details into Consent Desk.
- Consent types: General, Surgery, Procedure, ICU, Blood Transfusion, Anesthesia, Teleconsultation.
- Attender relationship and mobile details.
- Doctor / consultant field with existing doctor suggestions.
- Consent status: pending, signed, approved, cancelled.
- Typed digital signature fields for patient, attender, and doctor.
- Supporting document reference field.
- Notes / consent summary field.
- Consent history panel with date, status, doctor, consent type, and signer.
- Backend consent table migration so new consent types/statuses are accepted.

## Verification
- Backend Python syntax check passed.
- Frontend production build passed after dependency install.
