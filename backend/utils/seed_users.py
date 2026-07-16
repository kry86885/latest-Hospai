import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(PROJECT_ROOT / ".env", override=False)
load_dotenv(BACKEND_DIR / ".env", override=False)

from utils.auth import ASSIGNABLE_MODULES, hash_password, modules_to_storage
from utils.database import get_connection, init_database, resolve_hospital_id


def upsert_user(cursor, hospital_id, user):
    password_hash = hash_password(user["password"])
    cursor.execute(
        "SELECT id FROM users WHERE username = ? AND hospital_id = ?",
        (user["username"], hospital_id),
    )
    existing = cursor.fetchone()
    values = (
        password_hash,
        user["role"],
        user["access_role"],
        user["user_type"],
        modules_to_storage(user["module_access"]),
        user["job_role"],
        user["name"],
        user["department"],
        user["employee_id"],
        "active",
    )
    if existing:
        cursor.execute(
            """
            UPDATE users
            SET password_hash = ?, role = ?, access_role = ?, user_type = ?, module_access = ?,
                job_role = ?, full_name = ?, department = ?, employee_id = ?, status = ?
            WHERE id = ?
            """,
            values + (existing["id"],),
        )
        return "updated"

    cursor.execute(
        """
        INSERT INTO users (
            hospital_id, username, password_hash, role, access_role, user_type, module_access,
            job_role, full_name, email, phone, department, employee_id, status, address, emergency_contact
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, '', '')
        """,
        (
            hospital_id,
            user["username"],
            password_hash,
            user["role"],
            user["access_role"],
            user["user_type"],
            modules_to_storage(user["module_access"]),
            user["job_role"],
            user["name"],
            user["department"],
            user["employee_id"],
            "active",
        ),
    )
    return "created"


def main():
    if not os.getenv("DATABASE_URL"):
        raise SystemExit("DATABASE_URL is required in backend/.env")

    init_database()
    hospital_id = resolve_hospital_id()
    users = [
        {
            "name": "verara",
            "username": "verara",
            "password": "verara@2324",
            "role": "employee",
            "access_role": "owner",
            "user_type": "admin",
            "module_access": list(ASSIGNABLE_MODULES),
            "job_role": "Owner / Admin",
            "department": "Administration",
            "employee_id": "EMP-VERARA",
        },
        {
            "name": "employee",
            "username": "employee",
            "password": "verara123",
            "role": "staff",
            "access_role": "receptionist",
            "user_type": "normal",
            "module_access": ["dashboard", "patients", "billing"],
            "job_role": "Employee",
            "department": "Operations",
            "employee_id": "EMP-EMPLOYEE",
        },
    ]

    with get_connection() as conn:
        cursor = conn.cursor()
        for user in users:
            action = upsert_user(cursor, hospital_id, user)
            print(f"[+] {user['username']} {action} with hashed password")
        conn.commit()

    print("[+] Seed users complete")


if __name__ == "__main__":
    main()
