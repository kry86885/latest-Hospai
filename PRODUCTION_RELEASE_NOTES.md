# HospAI Production Release Notes

## Included production updates
- Payment Collection > Record Payment: entering Patient ID / UHID auto-fills patient name and pending due details where available.
- Existing pending dues/invoices are selected automatically for that patient.
- Recording payment against a selected due updates the existing invoice/payment record instead of creating duplicate direct payment records.
- Payment Summary reloads after every successful payment, so existing and future payment changes reflect immediately.
- Frontend production build was regenerated in `frontend/dist`.
- Short-path folder structure is preserved: extract this zip near `C:\HospAI` or Desktop to avoid Windows path-depth problems.

## Production package notes
- `frontend/node_modules` is intentionally not included. Run `START_FRONTEND_WINDOWS.bat`; it will install exact dependencies from `package-lock.json`.
- Python virtual environment is intentionally not included. Run `START_BACKEND_WINDOWS.bat`; it will create `.venv` and install backend dependencies.
- Configure `.env` from `.env.example` before using real hospital/client data.
- Keep PostgreSQL database hospai backed up regularly because it contains persistent records.

## Recommended first run
1. Extract the zip to `C:\HospAI` or Desktop.
2. Double-click `START_BACKEND_WINDOWS.bat`.
3. Double-click `START_FRONTEND_WINDOWS.bat`.
4. Open `http://localhost:5173`.
5. Test Payment Collection with an existing patient ID and pending due.
