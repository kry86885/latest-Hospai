# Production Checklist

Before sharing with hospital/client systems:

- Change all default secrets in `.env`.
- Confirm backend runs on `http://127.0.0.1:5001/api/health`.
- Confirm frontend opens on `http://localhost:5173`.
- Test patient registration, OP queue, invoice/due creation, record payment, and payment summary refresh.
- Back up PostgreSQL database `hospai` before and after daily usage.
- Do not delete `backend/uploads` if documents are stored locally.
- For desktop/exe packaging, build from this source after verifying the web app flow.
