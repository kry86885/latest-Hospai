# HospAI Frontend + Backend Run Guide

This folder has been cleaned as a source-code project. EXE/Electron packaging artifacts and generated dependency/runtime folders were removed.

## Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Backend runs on: `http://127.0.0.1:5000`

## Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on: `http://localhost:5173`

## Notes

- `frontend/vite.config.js` proxies `/api` calls to the Flask backend.
- `frontend/.env.example` contains the frontend API base URL.
- `backend/uploads/` is preserved for uploaded files.
- Existing backend and frontend business logic files were preserved.
