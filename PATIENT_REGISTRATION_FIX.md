# Patient Registration Fix

Fixed the blank Patient Registration page at `?page=add`.

## Root cause
`AddPatientPage.tsx` rendered the Appointment In section using `appointment` and `handleAppointmentChange`, but those state variables/functions were missing. This caused a frontend runtime error and the page appeared blank.

## Fix applied
- Added Appointment In local state.
- Added `handleAppointmentChange` handler.
- Reset Appointment In form on Clear.
- Verified frontend production build with `npm run build`.

## Run
Backend:
```bash
cd backend
pip install -r requirements.txt
python app.py
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```
