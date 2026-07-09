# HospAI / Keppler Healthcare - Start Here (Windows)

This repository is a source-code project, not a ready-made `.exe` file.
It runs as a local web application with:

- Backend API: Flask on http://localhost:5001
- Symptom AI API: Flask on http://localhost:5002
- Frontend app: React/Vite on http://localhost:5173
- Optional marketing site: static Vite site under `site/`

## 1) Run Backend

Open CMD/PowerShell in the project root, then run:

```cmd
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Expected result:

```txt
Running on http://127.0.0.1:5001
```

Test URL:

```txt
http://localhost:5001/api/health
```

You should see:

```json
{"status":"ok"}
```

## 2) Run Symptom Backend

Open a second CMD/PowerShell window:

```cmd
cd symptom_backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Expected result:

```txt
Running on http://127.0.0.1:5002
```

Test URL:

```txt
http://localhost:5002/api/health
```

## 3) Run Frontend

Open a third CMD/PowerShell window:

```cmd
cd frontend
npm install
npm run dev
```

Open:

```txt
http://localhost:5173
```

## Important Notes

- The old README used `source .venv/bin/activate`, which is for Linux/Mac. On Windows use `.venv\Scripts\activate`.
- Backend now supports local file uploads without requiring `BUCKET_URL`.
- For cloud/S3 storage, configure `BUCKET_URL` and AWS/S3 variables in `.env`.
- `gunicorn` is included in requirements for production Linux servers. On Windows local development, use `python app.py`.
- This project contains Electron config, so a desktop installer can be built later, but the ZIP itself is not a prebuilt executable installer.
