import json
import sqlite3
from datetime import datetime
from pathlib import Path

import bcrypt

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "healthcare.db"
DEFAULT_USERNAME = "verara"
DEFAULT_PASSWORD = "verara123"
DEFAULT_MODULES = ["dashboard", "patients", "billing", "pharmacy", "lab", "hrms", "ot", "accounts", "reports"]
OPERATIONAL_TABLES = [
    "patients",
    "appointments",
    "admissions",
    "invoices",
    "invoice_payments",
    "documents",
    "encounters",
    "diagnostics",
    "pharmacy_inventory",
    "pharmacy_sales",
    "pharmacy_purchases",
    "pharmacy_suppliers",
    "lab_vendors",
    "patient_consents",
    "insurance_verifications",
    "insurance_claims",
    "certificates",
    "doctor_schedules",
    "department_master",
    "attendance",
    "payroll",
    "leave_requests",
    "audit_logs",
    "shared_exports",
    "accounts_ledger",
    "vendor_payments",
    "doctor_payouts",
    "ot_theatres",
    "ot_surgeries",
    "bed_allocations",
    "medication_schedules",
    "observation_notes",
    "patient_movements",
    "sessions",
]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def table_exists(cursor: sqlite3.Cursor, table_name: str) -> bool:
    cursor.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
    return cursor.fetchone() is not None


def ensure_default_hospital(cursor: sqlite3.Cursor) -> int:
    if not table_exists(cursor, "hospitals"):
        return 1
    cursor.execute("SELECT id FROM hospitals WHERE code = ?", ("hosp-default",))
    row = cursor.fetchone()
    if row:
        return int(row[0])
    cursor.execute(
        "INSERT INTO hospitals (code, name, status) VALUES (?, ?, ?)",
        ("hosp-default", "Default Hospital", "active"),
    )
    return int(cursor.lastrowid)


def clean_database() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys=OFF")

        for table in OPERATIONAL_TABLES:
            if table_exists(cursor, table):
                cursor.execute(f'DELETE FROM "{table}"')

        hospital_id = ensure_default_hospital(cursor)

        if table_exists(cursor, "users"):
            cursor.execute("DELETE FROM users")
            cursor.execute(
                """
                INSERT INTO users (
                    username,
                    password_hash,
                    role,
                    access_role,
                    user_type,
                    module_access,
                    job_role,
                    full_name,
                    email,
                    phone,
                    department,
                    employee_id,
                    status,
                    address,
                    emergency_contact,
                    hospital_id,
                    date_joined,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    DEFAULT_USERNAME,
                    hash_password(DEFAULT_PASSWORD),
                    "employee",
                    "owner",
                    "admin",
                    json.dumps(DEFAULT_MODULES),
                    "Owner / Admin",
                    DEFAULT_USERNAME,
                    "",
                    "",
                    "Administration",
                    "EMP-VERARA",
                    "active",
                    "",
                    "",
                    hospital_id,
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                ),
            )

        if table_exists(cursor, "sqlite_sequence"):
            for table in OPERATIONAL_TABLES:
                cursor.execute("DELETE FROM sqlite_sequence WHERE name = ?", (table,))

        conn.commit()
        cursor.execute("VACUUM")
        conn.commit()
    finally:
        conn.close()

    print(f"Cleaned client database: {DB_PATH}")
    print(f"Default login: {DEFAULT_USERNAME} / {DEFAULT_PASSWORD}")


if __name__ == "__main__":
    clean_database()
