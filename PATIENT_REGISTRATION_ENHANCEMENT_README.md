# Patient Registration Enhancement - Phase 1 Step 1

This build enhances only the Patient Registration workflow from the original HospAI offline project.

## What changed

- First Name is mandatory.
- Last Name is mandatory.
- DOB or Age is mandatory.
- Gender is mandatory.
- Primary Mobile is mandatory and must be exactly 10 digits.
- Address is mandatory.
- Family Mobile is added as an optional field for shared/family contacts.
- Emergency Contact Name and Emergency Relation fields are added.
- Frontend now shows field-level validation messages instead of silent failed saves.
- Backend also validates patient registration, so invalid data cannot be saved even if frontend validation is bypassed.
- Duplicate primary mobile number is blocked.
- Existing matching patient suggestion appears while typing phone/name.
- New fields are stored in PostgreSQL using additional patient columns.

## Important behavior

Primary Mobile should be unique per patient record. If multiple family members share a contact number, use the optional Family Mobile field instead of repeating the same Primary Mobile.

## Files modified

- backend/app.py
- backend/utils/database.py
- frontend/src/pages/AddPatientPage.tsx
- frontend/src/lib/constants.ts
- frontend/src/types.ts
- frontend/src/styles.css

## Run commands

### Backend

```cmd
cd backend
.venv\Scripts\activate
python app.py
```

### Symptom backend

```cmd
cd symptom_backend
.venv\Scripts\activate
python app.py
```

### Frontend

```cmd
cd frontend
npm run dev
```

Open:

```txt
http://localhost:5173
```

Then go to Patient Registration and test mandatory fields, duplicate primary mobile, address, emergency contact, and optional family mobile.
