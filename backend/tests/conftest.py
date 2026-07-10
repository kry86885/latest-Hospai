import os
import importlib
import sys

import pytest


@pytest.fixture(scope="session", autouse=True)
def test_db_env():
    if "backend" not in sys.path:
        sys.path.insert(0, os.path.dirname(__file__) + "/..")

    from utils.database import init_database
    from utils.auth import create_default_users

    init_database()
    create_default_users()

    from utils.database import get_connection, resolve_hospital_id
    from utils.auth import hash_password, modules_to_storage, ASSIGNABLE_MODULES
    hospital_id = resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE username = ? AND hospital_id = ?", ("Dr. PRABHU", hospital_id))
        if not cursor.fetchone():
            cursor.execute(
                """
                INSERT INTO users (
                    hospital_id, username, password_hash, role, access_role, user_type,
                    module_access, job_role, full_name, email, phone, department,
                    employee_id, status, address, emergency_contact
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    hospital_id,
                    "Dr. PRABHU",
                    hash_password("Dr. PRABHU@123"),
                    "employee",
                    "owner",
                    "admin",
                    modules_to_storage(list(ASSIGNABLE_MODULES)),
                    "Owner / Admin",
                    "Dr. PRABHU",
                    "",
                    "",
                    "Administration",
                    "EMP-PRABHU",
                    "active",
                    "",
                    ""
                )
            )
            conn.commit()

    yield


@pytest.fixture(scope="session")
def app_client(test_db_env):
    app_module = importlib.import_module("app")
    importlib.reload(app_module)

    app_module.app.config.update({"TESTING": True})

    with app_module.app.test_client() as client:
        yield client


@pytest.fixture()
def auth_client(app_client):
    response = app_client.post(
        "/api/auth/login",
        json={"username": "Dr. PRABHU", "password": "Dr. PRABHU@123"},
    )
    assert response.status_code == 200
    return app_client


@pytest.fixture(autouse=True)
def clean_database():
    from utils.database import get_connection, resolve_hospital_id

    with get_connection() as conn:
        cursor = conn.cursor()
        default_hospital_id = resolve_hospital_id()
        cursor.execute("DELETE FROM insurance_claims")
        cursor.execute("DELETE FROM patient_consents")
        cursor.execute("DELETE FROM insurance_verifications")
        cursor.execute("DELETE FROM certificates")
        cursor.execute("DELETE FROM doctor_schedules")
        cursor.execute("DELETE FROM appointments")
        cursor.execute("DELETE FROM ot_surgeries")
        cursor.execute("DELETE FROM ot_theatres")
        cursor.execute("DELETE FROM doctor_payouts")
        cursor.execute("DELETE FROM vendor_payments")
        cursor.execute("DELETE FROM accounts_ledger")
        cursor.execute("DELETE FROM documents")
        cursor.execute("DELETE FROM encounters")
        cursor.execute("DELETE FROM bed_allocations")
        cursor.execute("DELETE FROM medication_schedules")
        cursor.execute("DELETE FROM observation_notes")
        cursor.execute("DELETE FROM patient_movements")
        cursor.execute("DELETE FROM invoice_payments")
        cursor.execute("DELETE FROM invoices")
        cursor.execute("DELETE FROM diagnostics")
        cursor.execute("DELETE FROM lab_vendors")
        cursor.execute("DELETE FROM attendance")
        cursor.execute("DELETE FROM payroll")
        cursor.execute("DELETE FROM leave_requests")
        cursor.execute("DELETE FROM department_master")
        cursor.execute("DELETE FROM audit_logs")
        cursor.execute("DELETE FROM admissions")
        cursor.execute("DELETE FROM patients")
        cursor.execute("DELETE FROM sessions")
        cursor.execute(
            """
            DELETE FROM users
            WHERE NOT (hospital_id = ? AND username = 'Dr. PRABHU')
            """,
            (default_hospital_id,),
        )
        cursor.execute("DELETE FROM hospitals WHERE id <> ?", (default_hospital_id,))
        try:
            cursor.execute(
                "UPDATE users SET access_role='owner', user_type='admin', module_access='[\"dashboard\",\"patients\",\"billing\",\"lab\",\"hrms\",\"ot\",\"accounts\",\"reports\"]' WHERE username='Dr. PRABHU'"
            )
        except Exception:
            pass
        conn.commit()
    yield


@pytest.fixture()
def patient_payload():
    return {
        "name": "Test",
        "middle_name": "Q",
        "last_name": "Patient",
        "dob": "1990-01-01",
        "age": 34,
        "weight": 70,
        "height": 175,
        "gender": "Male",
        "pregnant": False,
        "allergies": "None",
        "symptoms": "Headache",
        "phone": "5550001234",
        "address": "Unit test address",
    }


@pytest.fixture()
def create_patient(auth_client, patient_payload):
    def _create(overrides=None):
        payload = dict(patient_payload)
        if overrides:
            payload.update(overrides)
        response = auth_client.post("/api/patients", json=payload)
        assert response.status_code == 200
        return response.get_json()["patient_id"]

    return _create
