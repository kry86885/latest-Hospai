import os
import json
import re
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
from dotenv import load_dotenv

try:
    import psycopg2
    from psycopg2.extras import DictCursor
except Exception:  # pragma: no cover - PostgreSQL driver guard
    psycopg2 = None
    DictCursor = None

try:
    import psycopg
except Exception:  # pragma: no cover - PostgreSQL driver guard
    psycopg = None

# Use project-level database so Streamlit and Flask share data
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"), override=False)
load_dotenv(os.path.join(BACKEND_DIR, ".env"), override=False)
DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
_DATABASE_URL_VALID = bool(
    DATABASE_URL
    and (DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgres://"))
)
IS_POSTGRES = True
try:
    DB_CONNECT_TIMEOUT_SECONDS = max(1, int(os.getenv("DB_CONNECT_TIMEOUT_SECONDS", "10")))
except ValueError:
    DB_CONNECT_TIMEOUT_SECONDS = 10

IST_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
DEFAULT_HOSPITAL_CODE = (os.getenv("DEFAULT_HOSPITAL_CODE") or "hosp-default").strip().lower()


def current_ist_datetime():
    return datetime.now(IST_TIMEZONE)


def current_ist_timestamp():
    return current_ist_datetime().isoformat(timespec="seconds")


def normalize_hospital_code(code):
    value = (code or DEFAULT_HOSPITAL_CODE).strip().lower()
    return value or DEFAULT_HOSPITAL_CODE


def _normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def _to_sql_params(sql: str, params=None):
    if params:
        sql = sql.replace("%", "%%")
    return sql.replace("?", "%s")


@contextmanager
def get_connection():
    if not _DATABASE_URL_VALID:
        raise RuntimeError(
            "DATABASE_URL is required. "
            "A valid PostgreSQL connection string is required. Please set DATABASE_URL in your .env file, "
            "e.g., DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@192.168.0.102:5432/hospai"
        )
    if psycopg2 is not None:
        conn = psycopg2.connect(
            _normalize_database_url(DATABASE_URL),
            cursor_factory=DictCursor,
            connect_timeout=DB_CONNECT_TIMEOUT_SECONDS,
        )
    elif psycopg is not None:
        conn = psycopg.connect(
            _normalize_database_url(DATABASE_URL),
            connect_timeout=DB_CONNECT_TIMEOUT_SECONDS,
        )
    else:
        raise RuntimeError(
            "PostgreSQL driver missing for DATABASE_URL. "
            "Install dependencies with `pip install -r backend/requirements.txt` "
            "or install either `psycopg2-binary` or `psycopg[binary]`."
        )
    try:
        yield _CompatConnection(conn, postgres=True)
    finally:
        conn.close()


class _CompatConnection:
    def __init__(self, conn, postgres=True):
        self._conn = conn
        self._postgres = postgres

    def cursor(self):
        return _CompatCursor(self._conn.cursor(), self._postgres)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def __getattr__(self, name):
        return getattr(self._conn, name)


class _CompatCursor:
    def __init__(self, cursor, postgres=True):
        self._cursor = cursor
        self._postgres = postgres
        self._lastrowid = None

    def execute(self, query, params=None):
        sql = _to_sql_params(query, params)
        is_insert = self._postgres and sql.strip().upper().startswith("INSERT") and "RETURNING" not in sql.upper()

        if is_insert:
            sql_with_returning = sql.rstrip().rstrip(";") + " RETURNING id"
            try:
                if params is None:
                    res = self._cursor.execute(sql_with_returning)
                else:
                    res = self._cursor.execute(sql_with_returning, params)
                try:
                    row = self._cursor.fetchone()
                    if row:
                        self._lastrowid = row[0]
                except Exception:
                    pass
                return res
            except Exception:
                # Table may not have an 'id' column (e.g. bed_config uses hospital_id as PK).
                # Roll back the failed statement and re-run without RETURNING.
                try:
                    self._cursor.connection.rollback()
                except Exception:
                    pass

        # Normal (non-INSERT or fallback) path.
        if params is None:
            return self._cursor.execute(sql)
        return self._cursor.execute(sql, params)

    def executemany(self, query, seq_of_params):
        sql = _to_sql_params(query, seq_of_params)
        return self._cursor.executemany(sql, seq_of_params)

    def fetchone(self):
        return self._wrap_row(self._cursor.fetchone())

    def fetchall(self):
        return [self._wrap_row(row) for row in self._cursor.fetchall()]

    @property
    def lastrowid(self):
        if self._postgres and self._lastrowid is not None:
            return self._lastrowid
        return getattr(self._cursor, "lastrowid", None)

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def _wrap_row(self, row):
        if row is None:
            return row
        if hasattr(row, "keys"):
            return row
        description = getattr(self._cursor, "description", None) or []
        columns = [col[0] for col in description]
        if not columns:
            return row
        return _RowProxy(row, columns)

    def __getattr__(self, name):
        return getattr(self._cursor, name)


class _RowProxy:
    def __init__(self, values, columns):
        self._values = tuple(values)
        self._columns = tuple(columns)
        self._index = {name: idx for idx, name in enumerate(self._columns)}

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return self._values[self._index[key]]

    def get(self, key, default=None):
        if key not in self._index:
            return default
        return self._values[self._index[key]]

    def items(self):
        return [(name, self._values[idx]) for idx, name in enumerate(self._columns)]

    def keys(self):
        return self._columns

    def __iter__(self):
        return iter(self.items())


def resolve_hospital_id(hospital_code=None):
    code = normalize_hospital_code(hospital_code)
    hospital = get_hospital_by_code(code)
    if hospital:
        return hospital["id"]
    hospital_id, _created = create_hospital(code)
    return hospital_id


def get_hospital_by_code(hospital_code):
    code = normalize_hospital_code(hospital_code)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM hospitals WHERE code = ?", (code,))
        return cursor.fetchone()


def create_hospital(hospital_code, name=None):
    code = normalize_hospital_code(hospital_code)
    hospital_name = (name or code.replace("-", " ").title()).strip() or "Default Hospital"
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM hospitals WHERE code = ?", (code,))
        existing = cursor.fetchone()
        if existing:
            return existing["id"], False
        cursor.execute(
            """
            INSERT INTO hospitals (code, name, status)
            VALUES (?, ?, 'active')
            RETURNING id
            """,
            (code, hospital_name),
        )
        hospital_id = cursor.fetchone()[0]
        conn.commit()
        return hospital_id, True


def list_hospitals():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, code, name, status, disabled_at, disabled_reason, created_at
            FROM hospitals
            ORDER BY created_at DESC, id DESC
            """
        )
        return cursor.fetchall()


def set_hospital_status(hospital_code, status, reason=None):
    status_value = (status or "").strip().lower()
    if status_value not in ("active", "inactive"):
        raise ValueError("status must be 'active' or 'inactive'")
    code = normalize_hospital_code(hospital_code)
    with get_connection() as conn:
        cursor = conn.cursor()
        if status_value == "inactive":
            cursor.execute(
                """
                UPDATE hospitals
                SET status = ?, disabled_at = CURRENT_TIMESTAMP, disabled_reason = ?
                WHERE code = ?
                """,
                (status_value, reason, code),
            )
        else:
            cursor.execute(
                """
                UPDATE hospitals
                SET status = ?, disabled_at = NULL, disabled_reason = NULL
                WHERE code = ?
                """,
                (status_value, code),
            )
        changed = cursor.rowcount > 0
        if changed and status_value == "inactive":
            cursor.execute(
                """
                DELETE FROM sessions
                WHERE hospital_id = (SELECT id FROM hospitals WHERE code = ?)
                """,
                (code,),
            )
        conn.commit()
        return changed


def init_database():
    try:
        with get_connection() as conn:
            # Confirm connection
            pass
        print("[+] PostgreSQL connection successful")
    except Exception as e:
        print(f"[-] Database connection failed: {e}")
        raise RuntimeError(f"PostgreSQL connection failed: {e}")

    with get_connection() as conn:
        cursor = conn.cursor()

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS hospitals (
                id SERIAL PRIMARY KEY,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
                disabled_at TIMESTAMP,
                disabled_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('employee', 'staff')),
                access_role TEXT DEFAULT 'receptionist' CHECK(access_role IN ('receptionist', 'clinician', 'hr_manager', 'owner')),
                user_type TEXT DEFAULT 'normal' CHECK(user_type IN ('admin', 'normal')),
                module_access TEXT DEFAULT '[]',
                job_role TEXT,
                full_name TEXT,
                email TEXT,
                phone TEXT,
                department TEXT,
                employee_id TEXT UNIQUE,
                date_joined TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
                address TEXT,
                emergency_contact TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS patients (
                id SERIAL PRIMARY KEY,
                patient_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                middle_name TEXT,
                last_name TEXT NOT NULL,
                dob DATE,
                age INTEGER,
                weight REAL,
                height REAL,
                gender TEXT,
                pregnant INTEGER DEFAULT 0,
                allergies TEXT,
                symptoms TEXT,
                phone TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS admissions (
                id SERIAL PRIMARY KEY,
                patient_id TEXT NOT NULL,
                admission_date TIMESTAMP NOT NULL,
                discharge_date DATE,
                notes TEXT,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id SERIAL PRIMARY KEY,
                patient_id TEXT NOT NULL,
                admission_id INTEGER,
                doc_type TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT,
                mime_type TEXT,
                file_data BYTEA,
                ocr_text TEXT,
                ocr_language TEXT DEFAULT 'en',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                FOREIGN KEY (admission_id) REFERENCES admissions(id)
            )
            """
        )

        ensure_hospital_columns(conn)
        ensure_patient_columns(conn)
        ensure_user_columns(conn)
        ensure_document_columns(conn)
        ensure_hospai_module_tables(conn)

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_hospitals_code ON hospitals(code)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_patient_id ON patients(patient_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_patient_phone ON patients(phone)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_patient_name ON patients(name, last_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)")

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS shared_exports (
                id SERIAL PRIMARY KEY,
                share_token TEXT UNIQUE NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT,
                mime_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_shared_exports_token ON shared_exports(share_token)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_hospital_username ON users(hospital_id, username)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_patients_family_mobile ON patients(family_mobile)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_invoice_no ON invoices(invoice_no)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_diagnostics_invoice_no ON diagnostics(invoice_no)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_diagnostics_created_at ON diagnostics(created_at)")

        # Clean up existing legacy test patient details to separate name and UHID
        cursor.execute(
            """
            UPDATE patients
            SET name = 'HospAI', last_name = 'Patient'
            WHERE patient_id = 'HMS700001' AND name = 'HMS700001' AND last_name = 'Patient'
            """
        )
        repair_duplicate_uhid_suffixes(conn)

        conn.commit()
    migrate_employee_id_constraint()
    print("[+] PostgreSQL schema initialized")


def ensure_hospital_columns(conn):
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS hospitals (
            id SERIAL PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
            disabled_at TIMESTAMP,
            disabled_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        """
        INSERT INTO hospitals (code, name, status)
        VALUES (?, ?, 'active')
        ON CONFLICT (code) DO NOTHING
        """,
        (DEFAULT_HOSPITAL_CODE, "Default Hospital"),
    )
    cursor.execute("SELECT id FROM hospitals WHERE code = ?", (DEFAULT_HOSPITAL_CODE,))
    default_row = cursor.fetchone()
    if not default_row:
        return
    default_hospital_id = default_row[0]

    for table_name in ("users", "sessions", "patients", "admissions", "documents"):
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = ? AND column_name = 'hospital_id'
            """,
            (table_name,),
        )
        has_hospital_col = cursor.fetchone() is not None
        if not has_hospital_col:
            cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN hospital_id INTEGER")

        cursor.execute(
            f"UPDATE {table_name} SET hospital_id = ? WHERE hospital_id IS NULL",
            (default_hospital_id,),
        )


def ensure_department_master_scope(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM hospitals WHERE code = ?", (DEFAULT_HOSPITAL_CODE,))
    default_row = cursor.fetchone()
    if not default_row:
        return
    default_hospital_id = default_row[0]

    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'department_master'
        """
    )
    columns = {row[0] for row in cursor.fetchall()}
    if "hospital_id" not in columns:
        cursor.execute("ALTER TABLE department_master ADD COLUMN hospital_id INTEGER")
    cursor.execute(
        "UPDATE department_master SET hospital_id = ? WHERE hospital_id IS NULL",
        (default_hospital_id,),
    )
    cursor.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_department_master_hospital_name
        ON department_master(hospital_id, department_name)
        """
    )


def ensure_patient_columns(conn):
    """Add patient registration fields needed for safer offline registration."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'patients'
        """
    )
    existing = {row[0] for row in cursor.fetchall()}

    expected = {
        "address": "TEXT",
        "emergency_contact": "TEXT",
        "emergency_relation": "TEXT",
        "family_mobile": "TEXT",
    }
    for column, col_type in expected.items():
        if column not in existing:
            cursor.execute(f"ALTER TABLE patients ADD COLUMN {column} {col_type}")


def ensure_user_columns(conn):
    """Add any missing columns to users table for older databases."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'users'
        """
    )
    existing = {row[0] for row in cursor.fetchall()}
    expected = {
        "hospital_id": "INTEGER",
        "username": "TEXT",
        "password_hash": "TEXT",
        "role": "TEXT",
        "access_role": "TEXT DEFAULT 'receptionist'",
        "user_type": "TEXT DEFAULT 'normal'",
        "module_access": "TEXT DEFAULT '[]'",
        "job_role": "TEXT",
        "full_name": "TEXT",
        "email": "TEXT",
        "phone": "TEXT",
        "department": "TEXT",
        "employee_id": "TEXT",
        "date_joined": "TIMESTAMP",
        "status": "TEXT DEFAULT 'active'",
        "address": "TEXT",
        "emergency_contact": "TEXT",
        "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    }
    for column, col_type in expected.items():
        if column not in existing:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {column} {col_type}")
    cursor.execute("UPDATE users SET status='active' WHERE status IS NULL")
    cursor.execute(
        """
        UPDATE users
        SET access_role = CASE
            WHEN role = 'employee' THEN 'owner'
            WHEN role = 'staff' THEN 'receptionist'
            ELSE 'receptionist'
        END
        WHERE access_role IS NULL OR TRIM(access_role) = ''
    """
    )
    cursor.execute(
        """
        UPDATE users
        SET user_type = CASE
            WHEN access_role = 'owner' THEN 'admin'
            ELSE 'normal'
        END
        WHERE user_type IS NULL OR TRIM(user_type) = ''
    """
    )
    default_modules_normal = json.dumps(["dashboard", "patients"], separators=(",", ":"))
    default_modules_admin = json.dumps(
        ["dashboard", "patients", "billing", "lab", "hrms", "ot", "accounts", "reports"],
        separators=(",", ":"),
    )
    cursor.execute(
        """
        UPDATE users
        SET module_access = CASE
            WHEN user_type = 'admin' THEN ?
            ELSE ?
        END
        WHERE module_access IS NULL OR TRIM(module_access) = '' OR TRIM(module_access) = '[]'
    """,
        (default_modules_admin, default_modules_normal),
    )

    # (employee_id constraint migration handled separately in migrate_employee_id_constraint)


def migrate_employee_id_constraint():
    """Drop global UNIQUE on employee_id and replace with per-hospital index.
    Runs in its own connection so the DDL is not caught in any aborted transaction."""
    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_employee_id_key")
            conn.commit()
    except Exception:
        pass  # already removed or constraint doesn't exist
    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_users_hospital_employee_id
                ON users(hospital_id, employee_id)
                WHERE employee_id IS NOT NULL
                """
            )
            conn.commit()
    except Exception:
        pass  # already exists


def ensure_document_columns(conn):
    """Add any missing document storage columns for older databases."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'documents'
        """
    )
    existing = {row[0] for row in cursor.fetchall()}
    if "file_name" not in existing:
        cursor.execute("ALTER TABLE documents ADD COLUMN file_name TEXT")
    if "mime_type" not in existing:
        cursor.execute("ALTER TABLE documents ADD COLUMN mime_type TEXT")
    if "file_data" not in existing:
        cursor.execute("ALTER TABLE documents ADD COLUMN file_data BYTEA")


def ensure_hospai_module_tables(conn):
    cursor = conn.cursor()
    id_column = "SERIAL PRIMARY KEY"

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS encounters (
            id {id_column},
            patient_id TEXT NOT NULL,
            encounter_type TEXT NOT NULL CHECK(encounter_type IN ('OP', 'IP')),
            arrival_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            insurance_provider TEXT,
            insurance_policy_no TEXT,
            is_accident INTEGER DEFAULT 0,
            referral_source TEXT,
            referral_name TEXT,
            status TEXT DEFAULT 'active',
            created_by TEXT
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS bed_allocations (
            id {id_column},
            admission_id INTEGER NOT NULL,
            patient_id TEXT NOT NULL,
            ward TEXT,
            room_no TEXT,
            bed_no TEXT,
            amount_per_day REAL DEFAULT 0,
            total_days INTEGER DEFAULT 0,
            total_amount REAL DEFAULT 0,
            allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            released_at TIMESTAMP,
            status TEXT DEFAULT 'active'
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS bed_config (
            hospital_id INTEGER PRIMARY KEY,
            capacity INTEGER DEFAULT 50
        )
        """
    )

    cursor.execute(
         """
         INSERT INTO bed_config (hospital_id, capacity)
         VALUES (?, 50)
         ON CONFLICT (hospital_id) DO NOTHING
         """,
         (1,)
    )

    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'bed_allocations'
        """
    )
    bed_alloc_columns = {row[0] for row in cursor.fetchall()}
    for col, col_type in [("amount_per_day", "REAL DEFAULT 0"), ("total_days", "INTEGER DEFAULT 0"), ("total_amount", "REAL DEFAULT 0")]:
        if col not in bed_alloc_columns:
            cursor.execute(f"ALTER TABLE bed_allocations ADD COLUMN {col} {col_type}")

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS medication_schedules (
            id {id_column},
            patient_id TEXT NOT NULL,
            medicine_name TEXT NOT NULL,
            dosage TEXT,
            schedule_time TIMESTAMP NOT NULL,
            administered INTEGER DEFAULT 0,
            alert_enabled INTEGER DEFAULT 1,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS observation_notes (
            id {id_column},
            patient_id TEXT NOT NULL,
            admission_id INTEGER,
            doctor_name TEXT,
            note TEXT NOT NULL,
            treatment_plan TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS patient_movements (
            id {id_column},
            patient_id TEXT NOT NULL,
            admission_id INTEGER,
            from_department TEXT,
            to_department TEXT NOT NULL,
            moved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            moved_by TEXT
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS invoices (
            id {id_column},
            invoice_no TEXT UNIQUE NOT NULL,
            patient_id TEXT,
            module TEXT NOT NULL CHECK(module IN ('OP', 'IP', 'LAB', 'PHARMACY')),
            doctor_name TEXT,
            clinic_name TEXT,
            referral_source TEXT,
            subtotal REAL DEFAULT 0,
            tax REAL DEFAULT 0,
            discount REAL DEFAULT 0,
            total_amount REAL NOT NULL,
            paid_amount REAL DEFAULT 0,
            due_amount REAL DEFAULT 0,
            payment_status TEXT DEFAULT 'due' CHECK(payment_status IN ('paid', 'partial', 'due', 'refunded')),
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'invoices'
        """
    )
    invoice_columns = {row[0] for row in cursor.fetchall()}
    if "advance_amount" not in invoice_columns:
        cursor.execute("ALTER TABLE invoices ADD COLUMN advance_amount REAL DEFAULT 0")
    if "refunded_amount" not in invoice_columns:
        cursor.execute("ALTER TABLE invoices ADD COLUMN refunded_amount REAL DEFAULT 0")

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS invoice_payments (
            id {id_column},
            invoice_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            payment_mode TEXT NOT NULL CHECK(payment_mode IN ('cash', 'card', 'upi', 'bank')),
            gateway_ref TEXT,
            converted_from_mode TEXT,
            converted_to_mode TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS insurance_claims (
            id {id_column},
            invoice_id INTEGER NOT NULL,
            patient_id TEXT,
            insurer_name TEXT NOT NULL,
            claim_amount REAL NOT NULL,
            approved_amount REAL DEFAULT 0,
            claim_status TEXT NOT NULL DEFAULT 'submitted' CHECK(claim_status IN ('submitted', 'under_review', 'approved', 'rejected', 'settled')),
            external_ref TEXT,
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            notes TEXT
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS pharmacy_inventory (
            id {id_column},
            medicine_name TEXT NOT NULL,
            batch_no TEXT,
            quantity INTEGER NOT NULL DEFAULT 0,
            reorder_level INTEGER DEFAULT 10,
            unit_price REAL DEFAULT 0,
            expiry_date DATE,
            stock_condition TEXT DEFAULT 'proper' CHECK(stock_condition IN ('proper', 'damaged')),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'pharmacy_inventory'
        """
    )
    pharmacy_inventory_columns = {row[0] for row in cursor.fetchall()}
    inventory_column_defaults = {
        "batch_no": "TEXT",
        "quantity": "INTEGER NOT NULL DEFAULT 0",
        "reorder_level": "INTEGER DEFAULT 10",
        "unit_price": "REAL DEFAULT 0",
        "expiry_date": "DATE",
        "stock_condition": "TEXT DEFAULT 'proper'",
        "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    }
    for column_name, column_definition in inventory_column_defaults.items():
        if column_name not in pharmacy_inventory_columns:
            cursor.execute(f"ALTER TABLE pharmacy_inventory ADD COLUMN {column_name} {column_definition}")

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS pharmacy_sales (
            id {id_column},
            invoice_id INTEGER,
            medicine_name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            amount REAL NOT NULL,
            sold_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'pharmacy_sales'
        """
    )
    pharmacy_sales_columns = {row[0] for row in cursor.fetchall()}
    if "patient_id" not in pharmacy_sales_columns:
        cursor.execute("ALTER TABLE pharmacy_sales ADD COLUMN patient_id TEXT")
    if "prescription_ref" not in pharmacy_sales_columns:
        cursor.execute("ALTER TABLE pharmacy_sales ADD COLUMN prescription_ref TEXT")
    if "payment_mode" not in pharmacy_sales_columns:
        cursor.execute("ALTER TABLE pharmacy_sales ADD COLUMN payment_mode TEXT DEFAULT 'cash'")

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS pharmacy_suppliers (
            id {id_column},
            supplier_name TEXT NOT NULL,
            contact_person TEXT,
            phone TEXT,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS pharmacy_purchases (
            id {id_column},
            supplier_id INTEGER,
            medicine_name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_cost REAL NOT NULL,
            total_cost REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered', 'received', 'cancelled')),
            expected_date DATE,
            received_date DATE,
            stock_applied INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS lab_vendors (
            id {id_column},
            vendor_name TEXT NOT NULL,
            contact_person TEXT,
            phone TEXT,
            status TEXT DEFAULT 'active'
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS diagnostics (
            id {id_column},
            invoice_no TEXT,
            patient_id TEXT,
            vendor_id INTEGER,
            doctor_name TEXT,
            test_name TEXT NOT NULL,
            amount REAL NOT NULL,
            paid_amount REAL DEFAULT 0,
            due_amount REAL DEFAULT 0,
            status TEXT DEFAULT 'due' CHECK(status IN ('paid', 'partial', 'due')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'diagnostics'
        """
    )
    diagnostic_columns = {row[0] for row in cursor.fetchall()}
    if "sample_barcode" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN sample_barcode TEXT")
    if "order_status" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN order_status TEXT DEFAULT 'ordered'")
    if "collected_at" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN collected_at TIMESTAMP")
    if "reported_at" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN reported_at TIMESTAMP")
    if "patient_name" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN patient_name TEXT")
    if "age" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN age INTEGER")
    if "gender" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN gender TEXT")
    if "department" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN department TEXT")
    if "visit_type" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN visit_type TEXT")
    if "visit_id" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN visit_id TEXT")
    if "bill_date" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN bill_date DATE")
    if "due_date" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN due_date DATE")
    if "payment_mode" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN payment_mode TEXT")
    if "transaction_id" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN transaction_id TEXT")
    if "discount_percentage" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN discount_percentage REAL DEFAULT 0")
    if "discount_amount" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN discount_amount REAL DEFAULT 0")
    if "tax_percentage" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN tax_percentage REAL DEFAULT 0")
    if "tax_amount" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN tax_amount REAL DEFAULT 0")
    if "report_delivery_mode" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN report_delivery_mode TEXT")
    if "report_delivery_date" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN report_delivery_date DATE")
    if "remarks" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN remarks TEXT")

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS department_master (
            id {id_column},
            hospital_id INTEGER,
            department_name TEXT NOT NULL,
            mapped_head_employee_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(hospital_id, department_name)
        )
        """
    )
    ensure_department_master_scope(conn)

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS attendance (
            id {id_column},
            employee_id TEXT NOT NULL,
            attendance_date DATE NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'leave')),
            in_time TEXT,
            out_time TEXT,
            notes TEXT
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS payroll (
            id {id_column},
            employee_id TEXT NOT NULL,
            payroll_month TEXT NOT NULL,
            basic_salary REAL NOT NULL,
            allowances REAL DEFAULT 0,
            deductions REAL DEFAULT 0,
            net_salary REAL NOT NULL,
            paid_status TEXT DEFAULT 'pending' CHECK(paid_status IN ('pending', 'paid')),
            paid_date DATE
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS leave_requests (
            id {id_column},
            employee_id TEXT NOT NULL,
            leave_type TEXT NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            reason TEXT,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
            decided_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id {id_column},
            actor_username TEXT,
            action TEXT NOT NULL,
            module_name TEXT NOT NULL,
            entity_key TEXT,
            payload TEXT,
            ip_address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS appointments (
            id {id_column},
            patient_id TEXT,
            patient_name TEXT NOT NULL,
            visit_type TEXT NOT NULL CHECK(visit_type IN ('OP', 'IP')),
            department TEXT,
            doctor_name TEXT,
            appointment_date TIMESTAMP NOT NULL,
            token_no INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled')),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'appointments'
        """
    )
    appointment_columns = {row[0] for row in cursor.fetchall()}
    if "appointment_kind" not in appointment_columns:
        cursor.execute("ALTER TABLE appointments ADD COLUMN appointment_kind TEXT DEFAULT 'new'")
    if "follow_up_for" not in appointment_columns:
        cursor.execute("ALTER TABLE appointments ADD COLUMN follow_up_for INTEGER")
    if "reminder_sent_at" not in appointment_columns:
        cursor.execute("ALTER TABLE appointments ADD COLUMN reminder_sent_at TIMESTAMP")
    if "no_show_marked" not in appointment_columns:
        cursor.execute("ALTER TABLE appointments ADD COLUMN no_show_marked INTEGER DEFAULT 0")
    if "consultation_fee" not in appointment_columns:
        cursor.execute("ALTER TABLE appointments ADD COLUMN consultation_fee REAL DEFAULT 0")

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS doctor_schedules (
            id {id_column},
            doctor_name TEXT NOT NULL,
            department TEXT,
            schedule_date DATE,
            start_time TEXT,
            end_time TEXT,
            slot_capacity INTEGER DEFAULT 12,
            consultation_fee REAL DEFAULT 0,
            review_fee REAL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'full', 'leave')),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'doctor_schedules'")
    doctor_schedule_columns = {row[0] for row in cursor.fetchall()}
    if "consultation_fee" not in doctor_schedule_columns:
        cursor.execute("ALTER TABLE doctor_schedules ADD COLUMN consultation_fee REAL DEFAULT 0")
    if "review_fee" not in doctor_schedule_columns:
        cursor.execute("ALTER TABLE doctor_schedules ADD COLUMN review_fee REAL DEFAULT 0")

    # Migration: make schedule_date, start_time, end_time nullable.
    # We query information_schema to check if columns are NOT NULL, and ALTER them accordingly.
    try:
        cursor.execute(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'doctor_schedules'
            """
        )
        col_info = {row[0]: row[1] for row in cursor.fetchall()}
        if col_info.get("schedule_date") == "NO":
            cursor.execute("ALTER TABLE doctor_schedules ALTER COLUMN schedule_date DROP NOT NULL")
        if col_info.get("start_time") == "NO":
            cursor.execute("ALTER TABLE doctor_schedules ALTER COLUMN start_time DROP NOT NULL")
        if col_info.get("end_time") == "NO":
            cursor.execute("ALTER TABLE doctor_schedules ALTER COLUMN end_time DROP NOT NULL")
    except Exception:
        pass  # If migration fails, ignore safely
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS patient_consents (
            id {id_column},
            patient_id TEXT,
            patient_name TEXT NOT NULL,
            consent_type TEXT NOT NULL,
            signed_by TEXT NOT NULL,
            relation_to_patient TEXT,
            status TEXT NOT NULL DEFAULT 'signed',
            notes TEXT,
            signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS insurance_verifications (
            id {id_column},
            patient_id TEXT,
            patient_name TEXT NOT NULL,
            insurer_name TEXT NOT NULL,
            policy_number TEXT,
            member_id TEXT,
            verification_status TEXT NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending', 'verified', 'rejected')),
            coverage_notes TEXT,
            checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS certificates (
            id {id_column},
            patient_id TEXT NOT NULL,
            admission_id INTEGER,
            certificate_type TEXT NOT NULL CHECK(certificate_type IN ('discharge_summary', 'medical_certificate', 'insurance_document', 'fit_to_work')),
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            issued_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS ot_theatres (
            id {id_column},
            theatre_code TEXT NOT NULL UNIQUE,
            theatre_name TEXT NOT NULL,
            equipment_notes TEXT,
            status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'maintenance', 'occupied')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS ot_surgeries (
            id {id_column},
            theatre_id INTEGER NOT NULL,
            patient_id TEXT,
            procedure_name TEXT NOT NULL,
            surgeon_name TEXT NOT NULL,
            scheduled_start TIMESTAMP NOT NULL,
            estimated_duration_hours REAL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
            equipment_required TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS accounts_ledger (
            id {id_column},
            entry_date DATE NOT NULL,
            entry_type TEXT NOT NULL CHECK(entry_type IN ('income', 'expense', 'adjustment')),
            category TEXT NOT NULL,
            reference_no TEXT,
            counterparty_name TEXT,
            amount REAL NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS vendor_payments (
            id {id_column},
            vendor_name TEXT NOT NULL,
            invoice_ref TEXT,
            amount REAL NOT NULL,
            payment_date DATE NOT NULL,
            payment_mode TEXT NOT NULL CHECK(payment_mode IN ('cash', 'card', 'upi', 'bank')),
            status TEXT NOT NULL DEFAULT 'paid' CHECK(status IN ('pending', 'partial', 'paid')),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS doctor_payouts (
            id {id_column},
            doctor_name TEXT NOT NULL,
            payout_month TEXT NOT NULL,
            amount REAL NOT NULL,
            paid_amount REAL DEFAULT 0,
            due_amount REAL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'partial', 'paid')),
            paid_date DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoice_patient ON invoices(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoice_status ON invoices(payment_status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_payments_invoice ON invoice_payments(invoice_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_claims_invoice ON insurance_claims(invoice_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_claims_status ON insurance_claims(claim_status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_patient ON pharmacy_sales(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_pharmacy_purchases_supplier ON pharmacy_purchases(supplier_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_diagnostics_patient ON diagnostics(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_leaves_employee ON leave_requests(employee_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_doctor_schedules_date ON doctor_schedules(schedule_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_doctor_schedules_doctor ON doctor_schedules(doctor_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_patient_consents_patient ON patient_consents(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_insurance_verifications_patient ON insurance_verifications(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_certificates_patient ON certificates(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ot_surgeries_theatre ON ot_surgeries(theatre_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ot_surgeries_status ON ot_surgeries(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_accounts_ledger_type ON accounts_ledger(entry_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor ON vendor_payments(vendor_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_doctor_payouts_doctor ON doctor_payouts(doctor_name)")


# ==================== Patient operations ====================

def _extract_uhid_date(patient_id):
    parts = str(patient_id or "").split("-")
    if len(parts) >= 3 and parts[0] == "PAT" and parts[1].isdigit() and len(parts[1]) == 8:
        return parts[1]
    return None


def _extract_uhid_suffix(patient_id):
    """Return the numeric last-4 UHID suffix for PAT and legacy IDs."""
    value = str(patient_id or "").strip()
    digits = ""
    for ch in reversed(value):
        if ch.isdigit():
            digits = ch + digits
        elif digits:
            break
    if not digits:
        return None
    try:
        return int(digits[-4:])
    except (TypeError, ValueError):
        return None


def _format_uhid_with_suffix(patient_id, suffix, fallback_date=None):
    id_date = _extract_uhid_date(patient_id) or fallback_date or current_ist_datetime().strftime("%Y%m%d")
    return f"PAT-{id_date}-{int(suffix):04d}"


def _next_unique_uhid_suffix(used_suffixes):
    next_suffix = (max(used_suffixes) if used_suffixes else 1000) + 1
    while next_suffix in used_suffixes:
        next_suffix += 1
    if next_suffix > 9999:
        raise RuntimeError("UHID last-4 sequence exhausted. Please archive old test data or widen the UHID suffix length.")
    return next_suffix


def _period_based_uhid_start(dt):
    """Build a 4-digit UHID floor from year, month, ISO week, and day.

    The full UHID already carries YYYYMMDD. This suffix floor adds a compact
    date-period signal and then increments from there for each new patient.
    """
    iso_week = int(dt.strftime("%V"))
    seed = ((dt.year % 100) * 372) + (dt.month * 31) + iso_week + int(dt.strftime("%d"))
    return ((seed % 89) + 10) * 100 + 1


def _next_period_based_uhid_suffix(used_suffixes, dt):
    period_start = _period_based_uhid_start(dt)
    next_suffix = max(period_start, (max(used_suffixes) + 1) if used_suffixes else period_start)
    while next_suffix in used_suffixes:
        next_suffix += 1
    if next_suffix > 9999:
        raise RuntimeError("UHID year/month/week/day sequence exhausted. Please archive old test data or widen the UHID suffix length.")
    return next_suffix


def generate_patient_id(hospital_id=None):
    """Generate date-prefixed sequential patient IDs per hospital.

    Required desktop format:
    PAT-YYYYMMDD-0001, PAT-YYYYMMDD-0002, PAT-YYYYMMDD-0003 ...

    The last 4 digits are the client-facing sequence and always start at
    0001 for a clean database. Existing legacy IDs are respected so the next
    generated ID stays unique and does not overwrite client data.
    """
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    today = current_ist_datetime().strftime("%Y%m%d")
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT patient_id FROM patients WHERE hospital_id = ?",
            (scoped_hospital_id,),
        )
        used_numbers = set()
        for row in cursor.fetchall():
            value = row["patient_id"] if hasattr(row, "keys") else row[0]
            suffix = _extract_uhid_suffix(value)
            if suffix is not None:
                used_numbers.add(int(suffix))
        next_number = 1
        while next_number in used_numbers:
            next_number += 1
        if next_number > 9999:
            raise RuntimeError("UHID last-4 sequence exhausted. Please archive old data or widen the UHID suffix length.")
        return f"PAT-{today}-{next_number:04d}"


def repair_duplicate_uhid_suffixes(conn):
    """Repair existing patient rows so last-4 UHID digits are unique per hospital.

    Older offline builds could create PAT-YYYYMMDD-0001 on multiple days. The
    app relies on last-4 lookup, so this startup migration renumbers only the
    duplicated suffix rows and updates every table that stores patient_id.
    """
    cursor = conn.cursor()
    cursor.execute("SELECT id, hospital_id, patient_id, created_at FROM patients ORDER BY hospital_id, created_at, id")
    rows = cursor.fetchall()
    by_hospital = {}
    for row in rows:
        hospital_id = row["hospital_id"] if "hospital_id" in row.keys() else None
        by_hospital.setdefault(hospital_id, []).append(row)

    # Discover every table with a patient_id column so references stay intact.
    reference_tables = [
        "admissions", "documents", "appointments", "patient_consents", "insurance_verifications",
        "certificates", "encounters", "bed_allocations", "medication_schedules", "observation_notes",
        "patient_movements", "invoices", "insurance_claims", "pharmacy_sales", "diagnostics", "patients",
    ]

    for _hospital_id, hospital_rows in by_hospital.items():
        all_suffixes = {
            suffix
            for row in hospital_rows
            for suffix in [_extract_uhid_suffix(row["patient_id"])]
            if suffix is not None
        }
        kept_suffixes = set()
        allocated_suffixes = set(all_suffixes)
        for row in hospital_rows:
            old_id = row["patient_id"]
            suffix = _extract_uhid_suffix(old_id)
            if suffix is None or suffix in kept_suffixes:
                created = str(row["created_at"] or "")
                fallback_date = created[:10].replace("-", "") if created else current_ist_datetime().strftime("%Y%m%d")
                suffix = _next_unique_uhid_suffix(allocated_suffixes)
                allocated_suffixes.add(suffix)
                new_id = _format_uhid_with_suffix(old_id, suffix, fallback_date=fallback_date)
                while new_id == old_id:
                    suffix = _next_unique_uhid_suffix(allocated_suffixes)
                    allocated_suffixes.add(suffix)
                    new_id = _format_uhid_with_suffix(old_id, suffix, fallback_date=fallback_date)
                for table in reference_tables:
                    cursor.execute(f"UPDATE {table} SET patient_id = ? WHERE patient_id = ?", (new_id, old_id))
                old_id = new_id
            kept_suffixes.add(suffix)


def check_duplicate_patient(name, last_name, dob, phone, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT patient_id, name, last_name FROM patients
            WHERE hospital_id = ? AND LOWER(name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
            AND (dob = ? OR phone = ?)
        """,
            (scoped_hospital_id, name, last_name, dob, phone),
        )
        return cursor.fetchone()


def get_patient_by_phone(phone, hospital_id=None):
    normalized = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if not normalized:
        return None
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT * FROM patients
            WHERE hospital_id = ? AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), ' ', ''), '-', ''), '+91', ''), '+', '') = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (scoped_hospital_id, normalized),
        )
        return cursor.fetchone()


def add_patient(data, hospital_id=None):
    scoped_hospital_id = hospital_id or data.get("hospital_id") or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO patients (hospital_id, patient_id, name, middle_name, last_name, dob, age, weight, height, gender, pregnant, allergies, symptoms, phone, address, emergency_contact, emergency_relation, family_mobile)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                scoped_hospital_id,
                data["patient_id"],
                data["name"],
                data.get("middle_name", ""),
                data["last_name"],
                data.get("dob"),
                data.get("age"),
                data.get("weight"),
                data.get("height"),
                data.get("gender"),
                data.get("pregnant", 0),
                data.get("allergies", ""),
                data.get("symptoms", ""),
                data.get("phone", ""),
                data.get("address", ""),
                data.get("emergency_contact", ""),
                data.get("emergency_relation", ""),
                data.get("family_mobile", ""),
            ),
        )
        conn.commit()
        return data["patient_id"]


def get_patient(patient_id, hospital_id=None):
    """Fetch a patient by full UHID, or by numeric UHID suffix for lookup screens."""
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    identifier = str(patient_id or "").strip()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM patients WHERE patient_id = ? AND hospital_id = ?",
            (identifier, scoped_hospital_id),
        )
        row = cursor.fetchone()
        if row:
            return row
        if identifier.isdigit():
            suffix = identifier[-4:].zfill(4)
            cursor.execute(
                """
                SELECT * FROM patients
                WHERE hospital_id = ? AND patient_id LIKE ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (scoped_hospital_id, f"%{suffix}"),
            )
            return cursor.fetchone()
        return None


def get_all_patients(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM patients WHERE hospital_id = ? ORDER BY created_at DESC",
            (scoped_hospital_id,),
        )
        return cursor.fetchall()


def _normalize_search_text(value):
    """Normalize text for patient search: case-insensitive, collapsed spaces."""
    return " ".join(str(value or "").lower().split())


def _digits_only(value):
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def search_patients(query, hospital_id=None):
    """Robust patient search by full/partial name, UHID, or phone.

    Supports queries like:
    - full name: "uday kiran"
    - partial name: "kir", "ram"
    - UHID/full or last digits: "PAT-20260623-0001", "0001", "1"
    - phone partial: "9876"
    """
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    normalized_query = _normalize_search_text(query)
    if not normalized_query:
        return []

    query_digits = _digits_only(normalized_query)
    query_tokens = [token for token in normalized_query.split() if token]

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM patients WHERE hospital_id = ? ORDER BY created_at DESC, id DESC",
            (scoped_hospital_id,),
        )
        rows = cursor.fetchall()

    def row_value(row, key):
        try:
            return row[key]
        except Exception:
            return ""

    def matches(row):
        first = row_value(row, "name")
        middle = row_value(row, "middle_name")
        last = row_value(row, "last_name")
        patient_id = row_value(row, "patient_id")
        phone = row_value(row, "phone")
        family_mobile = row_value(row, "family_mobile")
        emergency_contact = row_value(row, "emergency_contact")

        full_name_variants = [
            _normalize_search_text(" ".join(part for part in [first, middle, last] if part)),
            _normalize_search_text(" ".join(part for part in [first, last] if part)),
            _normalize_search_text(" ".join(part for part in [last, first] if part)),
            _normalize_search_text(first),
            _normalize_search_text(middle),
            _normalize_search_text(last),
        ]
        text_haystack = " | ".join(
            full_name_variants
            + [
                _normalize_search_text(patient_id),
                _normalize_search_text(phone),
                _normalize_search_text(family_mobile),
                _normalize_search_text(emergency_contact),
            ]
        )
        digit_haystack = " | ".join(
            _digits_only(value) for value in [patient_id, phone, family_mobile, emergency_contact]
        )

        if normalized_query in text_haystack:
            return True
        if query_tokens and all(token in text_haystack for token in query_tokens):
            return True
        if query_digits:
            if query_digits in digit_haystack:
                return True
            # Allow entering single/all suffix digits for PAT-YYYYMMDD-0001.
            patient_digits = _digits_only(patient_id)
            if patient_digits.endswith(query_digits) or patient_digits.endswith(query_digits.zfill(4)):
                return True
        return False

    return [row for row in rows if matches(row)]

def update_patient(patient_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE patients SET name=?, middle_name=?, last_name=?, dob=?, age=?, weight=?, height=?,
            gender=?, pregnant=?, allergies=?, symptoms=?, phone=?, address=?, emergency_contact=?, emergency_relation=?, family_mobile=?, updated_at=CURRENT_TIMESTAMP
            WHERE patient_id=?
        """,
            (
                data["name"],
                data.get("middle_name", ""),
                data["last_name"],
                data.get("dob"),
                data.get("age"),
                data.get("weight"),
                data.get("height"),
                data.get("gender"),
                data.get("pregnant", 0),
                data.get("allergies", ""),
                data.get("symptoms", ""),
                data.get("phone", ""),
                data.get("address", ""),
                data.get("emergency_contact", ""),
                data.get("emergency_relation", ""),
                data.get("family_mobile", ""),
                patient_id,
            ),
        )
        conn.commit()


def add_admission(patient_id, notes="", hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        admission_timestamp = current_ist_timestamp()
        cursor.execute(
            """
            INSERT INTO admissions (hospital_id, patient_id, admission_date, notes)
            VALUES (?, ?, ?, ?)
            RETURNING id
            """,
            (scoped_hospital_id, patient_id, admission_timestamp, notes),
        )
        admission_id = cursor.fetchone()[0]
        conn.commit()
        return admission_id


def get_admissions(patient_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM admissions WHERE patient_id = ? AND hospital_id = ? ORDER BY admission_date DESC",
            (patient_id, scoped_hospital_id),
        )
        return cursor.fetchall()


def add_document(
    patient_id,
    admission_id,
    doc_type,
    file_path,
    ocr_text="",
    ocr_language="en",
    file_name=None,
    mime_type=None,
    file_data=None,
    hospital_id=None,
):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        upload_timestamp = current_ist_timestamp()
        cursor.execute(
            """
            INSERT INTO documents (
                hospital_id, patient_id, admission_id, doc_type, file_path, file_name, mime_type, file_data, ocr_text, ocr_language, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                scoped_hospital_id,
                patient_id,
                admission_id,
                doc_type,
                file_path,
                file_name,
                mime_type,
                file_data,
                ocr_text,
                ocr_language,
                upload_timestamp,
            ),
        )
        document_id = cursor.fetchone()[0]
        conn.commit()
        return document_id


def get_documents(patient_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                id,
                patient_id,
                admission_id,
                doc_type,
                file_path,
                file_name,
                mime_type,
                ocr_text,
                ocr_language,
                created_at,
                CASE WHEN file_data IS NOT NULL THEN 1 ELSE 0 END AS has_file_data
            FROM documents
            WHERE patient_id = ? AND hospital_id = ?
            ORDER BY created_at DESC
            """,
            (patient_id, scoped_hospital_id),
        )
        return cursor.fetchall()


def get_document(document_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM documents WHERE id = ? AND hospital_id = ?",
            (document_id, scoped_hospital_id),
        )
        return cursor.fetchone()


def delete_document(document_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM documents WHERE id = ? AND hospital_id = ?",
            (document_id, scoped_hospital_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def update_document_ocr(document_id, ocr_text, ocr_language="en", hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE documents SET ocr_text = ?, ocr_language = ? WHERE id = ? AND hospital_id = ?",
            (ocr_text, ocr_language, document_id, scoped_hospital_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def get_patient_stats(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM patients WHERE hospital_id = ?", (scoped_hospital_id,))
        total = cursor.fetchone()[0]
        cursor.execute(
            "SELECT COUNT(*) FROM patients WHERE hospital_id = ? AND DATE(created_at) = CURRENT_DATE",
            (scoped_hospital_id,),
        )
        today = cursor.fetchone()[0]
        cursor.execute(
            "SELECT COUNT(*) FROM admissions WHERE hospital_id = ? AND discharge_date IS NULL",
            (scoped_hospital_id,),
        )
        active = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM documents WHERE hospital_id = ?", (scoped_hospital_id,))
        docs = cursor.fetchone()[0]
        cursor.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT patient_id
                FROM admissions
                WHERE hospital_id = ?
                GROUP BY patient_id
                HAVING COUNT(*) > 1
            )
            """
            ,
            (scoped_hospital_id,),
        )
        readmitted_patients = cursor.fetchone()[0]

        cursor.execute("SELECT capacity FROM bed_config WHERE hospital_id = ?", (scoped_hospital_id,))
        row_cap = cursor.fetchone()
        bed_capacity = row_cap[0] if row_cap else 50

        cursor.execute(
            "SELECT COUNT(*) FROM bed_allocations WHERE status = 'active' AND admission_id IN (SELECT id FROM admissions WHERE hospital_id = ?)",
            (scoped_hospital_id,)
        )
        active_beds = cursor.fetchone()[0]

    return {
        "total": total,
        "today": today,
        "active_admissions": active,
        "documents": docs,
        "readmitted_patients": readmitted_patients,
        "bed_capacity": bed_capacity,
        "active_beds": active_beds,
    }


def get_dashboard_analytics(days=14, include_employee=False, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    try:
        requested_days = int(days)
    except (TypeError, ValueError):
        requested_days = 14

    # Keep the window bounded so the dashboard stays fast and readable.
    window_days = max(7, min(requested_days, 60))
    start_date = current_ist_datetime().date() - timedelta(days=window_days - 1)
    day_range = [(start_date + timedelta(days=index)).isoformat() for index in range(window_days)]

    with get_connection() as conn:
        cursor = conn.cursor()

        cursor.execute(
            f"""
            SELECT DATE(created_at) AS day, COUNT(*) AS count
            FROM patients
            WHERE hospital_id = ? AND DATE(created_at) >= CURRENT_DATE - INTERVAL '{window_days - 1} days'
            GROUP BY DATE(created_at)
            ORDER BY day ASC
            """,
            (scoped_hospital_id,),
        )
        patient_trend_map = {row["day"]: row["count"] for row in cursor.fetchall()}

        cursor.execute(
            f"""
            SELECT DATE(created_at) AS day, COUNT(*) AS count
            FROM documents
            WHERE hospital_id = ? AND DATE(created_at) >= CURRENT_DATE - INTERVAL '{window_days - 1} days'
            GROUP BY DATE(created_at)
            ORDER BY day ASC
            """,
            (scoped_hospital_id,),
        )
        document_trend_map = {row["day"]: row["count"] for row in cursor.fetchall()}

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(gender), ''), 'Unknown') AS label, COUNT(*) AS count
            FROM patients
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
            ,
            (scoped_hospital_id,),
        )
        gender_distribution = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(doc_type), ''), 'Unknown') AS label, COUNT(*) AS count
            FROM documents
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
            ,
            (scoped_hospital_id,),
        )
        doc_type_distribution = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT CASE WHEN discharge_date IS NULL THEN 'Active' ELSE 'Discharged' END AS label, COUNT(*) AS count
            FROM admissions
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
            ,
            (scoped_hospital_id,),
        )
        admission_status_distribution = [dict(row) for row in cursor.fetchall()]

        analytics = {
            "window_days": window_days,
            "patients_trend": [{"date": day, "count": patient_trend_map.get(day, 0)} for day in day_range],
            "documents_trend": [{"date": day, "count": document_trend_map.get(day, 0)} for day in day_range],
            "gender_distribution": gender_distribution,
            "doc_type_distribution": doc_type_distribution,
            "admission_status_distribution": admission_status_distribution,
        }

        if include_employee:
            cursor.execute(
                """
                SELECT COALESCE(NULLIF(TRIM(status), ''), 'unknown') AS label, COUNT(*) AS count
                FROM users
                WHERE hospital_id = ?
                GROUP BY label
                ORDER BY count DESC, label ASC
                """
                ,
                (scoped_hospital_id,),
            )
            employee_status_distribution = [dict(row) for row in cursor.fetchall()]

            cursor.execute(
                """
                SELECT COALESCE(NULLIF(TRIM(department), ''), 'Unassigned') AS label, COUNT(*) AS count
                FROM users
                WHERE hospital_id = ?
                GROUP BY label
                ORDER BY count DESC, label ASC
                """
                ,
                (scoped_hospital_id,),
            )
            department_distribution = [dict(row) for row in cursor.fetchall()]

            cursor.execute(
                """
                SELECT COALESCE(NULLIF(TRIM(user_type), ''), 'unknown') AS label, COUNT(*) AS count
                FROM users
                WHERE hospital_id = ?
                GROUP BY label
                ORDER BY count DESC, label ASC
                """
                ,
                (scoped_hospital_id,),
            )
            access_role_distribution = [dict(row) for row in cursor.fetchall()]

            cursor.execute(
                "SELECT COUNT(*) AS total FROM users WHERE hospital_id = ?",
                (scoped_hospital_id,),
            )
            employee_total = cursor.fetchone()["total"]

            analytics["employee"] = {
                "total": employee_total,
                "status_distribution": employee_status_distribution,
                "department_distribution": department_distribution,
                "access_role_distribution": access_role_distribution,
            }

    return analytics


def delete_patient(patient_id, hospital_id=None):
    """Delete patient and all associated admissions/documents"""
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM documents WHERE patient_id = ? AND hospital_id = ?",
            (patient_id, scoped_hospital_id),
        )
        cursor.execute(
            "DELETE FROM admissions WHERE patient_id = ? AND hospital_id = ?",
            (patient_id, scoped_hospital_id),
        )
        cursor.execute(
            "DELETE FROM patients WHERE patient_id = ? AND hospital_id = ?",
            (patient_id, scoped_hospital_id),
        )
        conn.commit()
        return cursor.rowcount > 0


# ==================== Employee management ====================

def generate_employee_id(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT employee_id FROM users WHERE hospital_id = ? AND employee_id LIKE 'EMP-%'",
            (scoped_hospital_id,),
        )
        ids = [row[0] for row in cursor.fetchall()]
        
        max_num = 0
        for emp_id in ids:
            try:
                num = int(emp_id.split('-')[1])
                if num > max_num:
                    max_num = num
            except (IndexError, ValueError):
                continue
                
    return f"EMP-{max_num + 1:05d}"


def add_employee(data, hospital_id=None):
    scoped_hospital_id = hospital_id or data.get("hospital_id") or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO users (hospital_id, username, password_hash, role, job_role, full_name, email, phone,
                               department, employee_id, status, address, emergency_contact, access_role, user_type, module_access)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                scoped_hospital_id,
                data["username"],
                data["password_hash"],
                data.get("role", "employee"),
                data.get("job_role"),
                data.get("full_name"),
                data.get("email"),
                data.get("phone"),
                data.get("department"),
                data["employee_id"],
                data.get("status", "active"),
                data.get("address"),
                data.get("emergency_contact"),
                data.get("access_role", "receptionist"),
                data.get("user_type", "normal"),
                json.dumps(data.get("module_access", []), separators=(",", ":")),
            ),
        )
        employee_pk = cursor.fetchone()[0]
        conn.commit()
        return employee_pk


def get_all_employees(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, username, role, job_role, full_name, email, phone, department,
                   employee_id, date_joined, status, address, emergency_contact, created_at, access_role, user_type, module_access
            FROM users
            WHERE hospital_id = ?
            ORDER BY date_joined DESC
        """
            ,
            (scoped_hospital_id,),
        )
        return cursor.fetchall()


def get_employee(employee_id=None, username=None, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        if employee_id:
            cursor.execute(
                """
                SELECT id, username, role, job_role, full_name, email, phone, department,
                       employee_id, date_joined, status, address, emergency_contact, created_at, access_role, user_type, module_access
                FROM users WHERE employee_id = ? AND hospital_id = ?
            """,
                (employee_id, scoped_hospital_id),
            )
        elif username:
            cursor.execute(
                """
                SELECT id, username, role, job_role, full_name, email, phone, department,
                       employee_id, date_joined, status, address, emergency_contact, created_at, access_role, user_type, module_access
                FROM users WHERE username = ? AND hospital_id = ?
            """,
                (username, scoped_hospital_id),
            )
        else:
            return None
        return cursor.fetchone()


def update_employee(employee_id, data, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE users SET full_name=?, email=?, phone=?, department=?,
                           status=?, address=?, emergency_contact=?, job_role=?, access_role=COALESCE(?, access_role),
                           user_type=COALESCE(?, user_type), module_access=COALESCE(?, module_access)
            WHERE employee_id=? AND hospital_id=?
        """,
            (
                data.get("full_name"),
                data.get("email"),
                data.get("phone"),
                data.get("department"),
                data.get("status"),
                data.get("address"),
                data.get("emergency_contact"),
                data.get("job_role"),
                data.get("access_role"),
                data.get("user_type"),
                json.dumps(data["module_access"], separators=(",", ":")) if "module_access" in data else None,
                employee_id,
                scoped_hospital_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def deactivate_employee(employee_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET status='inactive' WHERE employee_id=? AND hospital_id=?",
            (employee_id, scoped_hospital_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def activate_employee(employee_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET status='active' WHERE employee_id=? AND hospital_id=?",
            (employee_id, scoped_hospital_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_employee(employee_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM users WHERE employee_id=? AND hospital_id=?",
            (employee_id, scoped_hospital_id),
        )
        row = cursor.fetchone()
        if row:
            user_id = row[0]
            cursor.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            cursor.execute(
                "DELETE FROM users WHERE id=?",
                (user_id,),
            )
            conn.commit()
            return True
        return False


def get_employee_stats(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM users WHERE status='active' AND hospital_id = ?",
            (scoped_hospital_id,),
        )
        active = cursor.fetchone()[0]
        cursor.execute(
            "SELECT COUNT(*) FROM users WHERE status='inactive' AND hospital_id = ?",
            (scoped_hospital_id,),
        )
        inactive = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM users WHERE hospital_id = ?", (scoped_hospital_id,))
        total = cursor.fetchone()[0]
    return {"total": total, "active": active, "inactive": inactive}


def check_if_first_user(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users WHERE hospital_id = ?", (scoped_hospital_id,))
        count = cursor.fetchone()[0]
    return count == 0


def search_employees(query, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        search = f"%{query}%"
        cursor.execute(
            """
            SELECT id, username, role, job_role, full_name, email, phone, department,
                   employee_id, date_joined, status, address, emergency_contact, created_at, access_role, user_type, module_access
            FROM users WHERE
            hospital_id = ? AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR employee_id LIKE ?)
            ORDER BY date_joined DESC
        """,
            (scoped_hospital_id, search, search, search, search),
        )
        return cursor.fetchall()


def _coerce_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _resolve_doctor_fee(conn, doctor_name, appointment_kind, appointment_date):
    if not doctor_name:
        return None
    appointment_day = str(appointment_date).split("T")[0].split(" ")[0]
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT consultation_fee, review_fee
        FROM doctor_schedules
        WHERE doctor_name = ? AND schedule_date = DATE(?)
        ORDER BY schedule_date DESC, created_at DESC
        LIMIT 1
        """,
        (doctor_name, appointment_day),
    )
    direct_match = cursor.fetchone()
    if direct_match:
        fee_value = direct_match["review_fee"] if str(appointment_kind).lower() in {"follow_up", "review"} else direct_match["consultation_fee"]
        return _coerce_float(fee_value)
    cursor.execute(
        """
        SELECT consultation_fee, review_fee
        FROM doctor_schedules
        WHERE doctor_name = ?
        ORDER BY schedule_date DESC, created_at DESC
        LIMIT 1
        """,
        (doctor_name,),
    )
    fallback = cursor.fetchone()
    if not fallback:
        return None
    fee_value = fallback["review_fee"] if str(appointment_kind).lower() in {"follow_up", "review"} else fallback["consultation_fee"]
    return _coerce_float(fee_value)


def create_appointment(data):
    appointment_date = data["appointment_date"]
    appointment_day = str(appointment_date).split("T")[0].split(" ")[0]
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COALESCE(MAX(token_no), 0) AS value FROM appointments WHERE DATE(appointment_date) = DATE(?)",
            (appointment_day,),
        )
        token_no = int((cursor.fetchone() or {"value": 0})["value"] or 0) + 1
        appointment_kind = str(data.get("appointment_kind") or "new").strip().lower()
        if appointment_kind in {"follow_up", "review"}:
            appointment_kind = "follow_up" if appointment_kind == "follow_up" else "follow_up"
        else:
            appointment_kind = "new"
        resolved_fee = data.get("consultation_fee")
        if resolved_fee in (None, "", 0):
            resolved_fee = _resolve_doctor_fee(conn, data.get("doctor_name"), appointment_kind, appointment_date)
        if resolved_fee in (None, ""):
            resolved_fee = 0.0
        resolved_fee = _coerce_float(resolved_fee)
        cursor.execute(
            """
            INSERT INTO appointments (
                patient_id, patient_name, visit_type, department, doctor_name,
                appointment_date, token_no, status, notes, appointment_kind, follow_up_for,
                reminder_sent_at, no_show_marked, consultation_fee
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("patient_id"),
                data["patient_name"],
                data.get("visit_type", "OP"),
                data.get("department"),
                data.get("doctor_name"),
                appointment_date,
                token_no,
                data.get("status", "scheduled"),
                data.get("notes"),
                appointment_kind,
                data.get("follow_up_for"),
                data.get("reminder_sent_at"),
                1 if data.get("no_show_marked") else 0,
                resolved_fee,
            ),
        )
        appointment_id = cursor.lastrowid
        conn.commit()
        return appointment_id, token_no


def list_appointments(appointment_date=None, status=None, visit_type=None, doctor_name=None, patient_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if appointment_date:
            clauses.append("DATE(appointment_date) = DATE(?)")
            params.append(appointment_date)
        if status:
            clauses.append("status = ?")
            params.append(status)
        if visit_type:
            clauses.append("visit_type = ?")
            params.append(visit_type)
        if doctor_name:
            clauses.append("doctor_name = ?")
            params.append(doctor_name)
        if patient_id:
            clauses.append("a.patient_id = ?")
            params.append(patient_id)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(
            f"""
            SELECT
                a.*,
                p.age AS age,
                p.gender AS gender,
                p.phone AS mobile,
                p.phone AS phone,
                TRIM(COALESCE(p.name, '') || ' ' || COALESCE(p.middle_name, '') || ' ' || COALESCE(p.last_name, '')) AS registered_patient_name
            FROM appointments a
            LEFT JOIN patients p ON p.patient_id = a.patient_id
            {where_clause}
            ORDER BY a.appointment_date ASC, a.token_no ASC
            """,
            tuple(params),
        )
        return cursor.fetchall()


def list_doctors_history(hospital_id, doctor_name=None, from_date=None, to_date=None, department=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = ["p.hospital_id = ?"]
        params = [scoped_hospital_id]
        if doctor_name and doctor_name != "All":
            clauses.append("a.doctor_name = ?")
            params.append(doctor_name)
        if from_date:
            clauses.append("DATE(a.appointment_date) >= DATE(?)")
            params.append(from_date)
        if to_date:
            clauses.append("DATE(a.appointment_date) <= DATE(?)")
            params.append(to_date)
        if department and department != "All":
            clauses.append("a.department = ?")
            params.append(department)
        
        where_clause = f" WHERE {' AND '.join(clauses)}"
        
        cursor.execute(
            f"""
            SELECT
                a.*,
                p.age AS age,
                p.gender AS gender,
                p.phone AS mobile,
                p.phone AS phone,
                TRIM(COALESCE(p.name, '') || ' ' || COALESCE(p.middle_name, '') || ' ' || COALESCE(p.last_name, '')) AS registered_patient_name
            FROM appointments a
            LEFT JOIN patients p ON p.patient_id = a.patient_id
            {where_clause}
            ORDER BY a.appointment_date DESC, a.token_no DESC
            """,
            tuple(params),
        )
        return cursor.fetchall()


def update_appointment(appointment_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM appointments WHERE id = ?", (appointment_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE appointments
            SET patient_id = ?,
                patient_name = ?,
                visit_type = ?,
                department = ?,
                doctor_name = ?,
                appointment_date = ?,
                status = ?,
                notes = ?,
                appointment_kind = ?,
                follow_up_for = ?,
                reminder_sent_at = ?,
                no_show_marked = ?,
                consultation_fee = ?
            WHERE id = ?
            """,
            (
                data.get("patient_id", existing["patient_id"]),
                data.get("patient_name", existing["patient_name"]),
                data.get("visit_type", existing["visit_type"]),
                data.get("department", existing["department"]),
                data.get("doctor_name", existing["doctor_name"]),
                data.get("appointment_date", existing["appointment_date"]),
                data.get("status", existing["status"]),
                data.get("notes", existing["notes"]),
                data.get("appointment_kind", existing["appointment_kind"]),
                data.get("follow_up_for", existing["follow_up_for"]),
                data.get("reminder_sent_at", existing["reminder_sent_at"]),
                1 if data.get("no_show_marked", existing["no_show_marked"]) else 0,
                _coerce_float(data.get("consultation_fee", existing["consultation_fee"])),
                appointment_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def _expand_schedule_dates(raw_schedule_date):
    if raw_schedule_date is None:
        raise ValueError("schedule_date is required")
    if isinstance(raw_schedule_date, (list, tuple)):
        raw_values = [str(item).strip() for item in raw_schedule_date if str(item).strip()]
    else:
        raw_text = str(raw_schedule_date).strip()
        if not raw_text:
            raise ValueError("schedule_date is required")
        raw_values = [item.strip() for item in re.split(r"[\s,]+", raw_text) if item.strip()]
    if not raw_values:
        raise ValueError("schedule_date is required")
    anchor_date = current_ist_datetime().date()
    parsed_dates = []
    day_map = {
        "mon": 0, "monday": 0,
        "tue": 1, "tuesday": 1,
        "wed": 2, "wednesday": 2,
        "thu": 3, "thursday": 3,
        "fri": 4, "friday": 4,
        "sat": 5, "saturday": 5,
        "sun": 6, "sunday": 6,
    }
    for token in raw_values:
        lowered = token.lower()
        if lowered in {"daily", "everyday", "every_day"}:
            parsed_dates.extend(anchor_date + timedelta(days=offset) for offset in range(7))
            continue
        if lowered in day_map:
            weekday = day_map[lowered]
            next_date = anchor_date
            while next_date.weekday() != weekday:
                next_date += timedelta(days=1)
            parsed_dates.append(next_date)
            continue
        try:
            if len(token) == 10 and token[4] == "-" and token[7] == "-":
                parsed_date = datetime.strptime(token, "%Y-%m-%d").date()
            else:
                parsed_date = datetime.strptime(token, "%d-%m-%Y").date()
            parsed_dates.append(parsed_date)
        except ValueError as error:
            raise ValueError(f"Invalid schedule date: {token}") from error
    unique_dates = []
    seen = set()
    for parsed_date in parsed_dates:
        key = parsed_date.isoformat()
        if key in seen:
            continue
        seen.add(key)
        unique_dates.append(parsed_date)
    if not unique_dates:
        raise ValueError("schedule_date is required")
    return unique_dates


def create_doctor_schedule(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        slot_capacity = int(data.get("slot_capacity") or 12)
        consultation_fee = _coerce_float(data.get("consultation_fee"))
        review_fee = _coerce_float(data.get("review_fee"))
        status = data.get("status", "available")
        notes = data.get("notes")
        doctor_name = data["doctor_name"]
        new_start = data.get("start_time") or "09:00"
        new_end = data.get("end_time") or "13:00"
        raw_date = data.get("schedule_date")

        # --- Permanent roster entry (no date) ---
        if not raw_date:
            cursor.execute(
                """
                INSERT INTO doctor_schedules (
                    doctor_name, department, schedule_date, start_time, end_time,
                    slot_capacity, consultation_fee, review_fee, status, notes
                ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    doctor_name,
                    data.get("department"),
                    new_start,
                    new_end,
                    slot_capacity,
                    consultation_fee,
                    review_fee,
                    status,
                    notes,
                ),
            )
            conn.commit()
            return cursor.lastrowid

        # --- Date-specific schedule (original path) ---
        schedule_dates = _expand_schedule_dates(raw_date)
        created_ids = []
        for schedule_date in schedule_dates:
            date_str = schedule_date.isoformat()
            # Block overlapping schedules for the SAME doctor on the same date.
            # Two ranges [s1, e1) and [s2, e2) overlap when s1 < e2 AND s2 < e1.
            # Different doctors on the same date/time are explicitly allowed.
            cursor.execute(
                """
                SELECT id, start_time, end_time FROM doctor_schedules
                WHERE doctor_name = ? AND schedule_date = ?
                  AND start_time < ? AND end_time > ?
                LIMIT 1
                """,
                (doctor_name, date_str, new_end, new_start),
            )
            conflict = cursor.fetchone()
            if conflict:
                raise ValueError(
                    f"Doctor '{doctor_name}' already has a schedule on {date_str} "
                    f"from {conflict['start_time']} to {conflict['end_time']} "
                    f"that overlaps with {new_start}\u2013{new_end}."
                )
            cursor.execute(
                """
                INSERT INTO doctor_schedules (
                    doctor_name, department, schedule_date, start_time, end_time,
                    slot_capacity, consultation_fee, review_fee, status, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    doctor_name,
                    data.get("department"),
                    date_str,
                    new_start,
                    new_end,
                    slot_capacity,
                    consultation_fee,
                    review_fee,
                    status,
                    notes,
                ),
            )
            created_ids.append(cursor.lastrowid)
        conn.commit()
        return created_ids[0] if created_ids else None


def list_doctor_schedules(schedule_date=None, doctor_name=None, status=None, department=None):
    """Return doctor schedules filtered by date, doctor, status, and/or department.

    Parameters
    ----------
    schedule_date : str, optional
        ISO date string (``YYYY-MM-DD``).  When provided only schedules whose
        ``schedule_date`` equals this value are returned.
    doctor_name : str, optional
        Exact doctor name match.
    status : str, optional
        One of ``'available'``, ``'full'``, or ``'leave'``.  Filters rows by
        the schedule status column.
    department : str, optional
        Exact department name match.
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if schedule_date:
            clauses.append("schedule_date = ?")
            params.append(schedule_date)
        if doctor_name:
            clauses.append("doctor_name = ?")
            params.append(doctor_name)
        if status:
            clauses.append("status = ?")
            params.append(status)
        if department:
            clauses.append("department = ?")
            params.append(department)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(
            f"SELECT * FROM doctor_schedules{where_clause} ORDER BY schedule_date ASC, start_time ASC",
            tuple(params),
        )
        return cursor.fetchall()


def update_doctor_schedule(schedule_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM doctor_schedules WHERE id = ?", (schedule_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        # Resolve the final values that will be written so we can check for conflicts.
        new_doctor = data.get("doctor_name", existing["doctor_name"])
        new_date = data.get("schedule_date", existing["schedule_date"])
        new_start = data.get("start_time", existing["start_time"])
        new_end = data.get("end_time", existing["end_time"])
        # Block overlapping schedules for the SAME doctor on the same date,
        # but exclude the row being updated from the conflict check.
        cursor.execute(
            """
            SELECT id, start_time, end_time FROM doctor_schedules
            WHERE doctor_name = ? AND schedule_date = ?
              AND id != ?
              AND start_time < ? AND end_time > ?
            LIMIT 1
            """,
            (new_doctor, new_date, schedule_id, new_end, new_start),
        )
        conflict = cursor.fetchone()
        if conflict:
            raise ValueError(
                f"Doctor '{new_doctor}' already has a schedule on {new_date} "
                f"from {conflict['start_time']} to {conflict['end_time']} "
                f"that overlaps with {new_start}\u2013{new_end}."
            )
        cursor.execute(
            """
            UPDATE doctor_schedules
            SET doctor_name = ?, department = ?, schedule_date = ?, start_time = ?,
                end_time = ?, slot_capacity = ?, consultation_fee = ?, review_fee = ?, status = ?, notes = ?
            WHERE id = ?
            """,
            (
                new_doctor,
                data.get("department", existing["department"]),
                new_date,
                new_start,
                new_end,
                int(data.get("slot_capacity", existing["slot_capacity"] or 12)),
                _coerce_float(data.get("consultation_fee", existing["consultation_fee"])),
                _coerce_float(data.get("review_fee", existing["review_fee"])),
                data.get("status", existing["status"]),
                data.get("notes", existing["notes"]),
                schedule_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_doctor_schedule(schedule_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM doctor_schedules WHERE id = ?", (schedule_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def get_op_summary(target_date=None):
    day = target_date or current_ist_datetime().strftime("%Y-%m-%d")
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS value FROM appointments WHERE visit_type = 'OP' AND DATE(appointment_date) = DATE(?)",
            (day,),
        )
        total_appointments = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COUNT(*) AS value FROM appointments WHERE visit_type = 'OP' AND appointment_kind = 'follow_up' AND DATE(appointment_date) = DATE(?)",
            (day,),
        )
        follow_ups = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COUNT(*) AS value FROM appointments WHERE visit_type = 'OP' AND status IN ('checked_in', 'in_consultation') AND DATE(appointment_date) = DATE(?)",
            (day,),
        )
        active_queue = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COUNT(*) AS value FROM appointments WHERE visit_type = 'OP' AND no_show_marked = 1 AND DATE(appointment_date) = DATE(?)",
            (day,),
        )
        no_shows = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COUNT(*) AS value FROM appointments WHERE visit_type = 'OP' AND reminder_sent_at IS NOT NULL AND DATE(appointment_date) = DATE(?)",
            (day,),
        )
        reminders_sent = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COUNT(*) AS value FROM doctor_schedules WHERE schedule_date = ? AND status = 'available'",
            (day,),
        )
        available_doctors = cursor.fetchone()["value"]
    return {
        "date": day,
        "total_appointments": total_appointments,
        "follow_ups": follow_ups,
        "active_queue": active_queue,
        "no_shows": no_shows,
        "reminders_sent": reminders_sent,
        "available_doctors": available_doctors,
    }


def create_patient_consent(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO patient_consents (
                patient_id, patient_name, consent_type, signed_by, relation_to_patient, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("patient_id"),
                data["patient_name"],
                data.get("consent_type", "general"),
                data["signed_by"],
                data.get("relation_to_patient"),
                data.get("status", "signed"),
                data.get("notes"),
            ),
        )
        consent_id = cursor.lastrowid
        conn.commit()
        return consent_id


def list_patient_consents(patient_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if patient_id:
            cursor.execute(
                "SELECT * FROM patient_consents WHERE patient_id = ? ORDER BY signed_at DESC, id DESC",
                (patient_id,),
            )
        else:
            cursor.execute("SELECT * FROM patient_consents ORDER BY signed_at DESC, id DESC")
        return cursor.fetchall()


def update_patient_consent(consent_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM patient_consents WHERE id = ?", (consent_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE patient_consents
            SET patient_id = ?, patient_name = ?, consent_type = ?, signed_by = ?,
                relation_to_patient = ?, status = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("patient_id", existing["patient_id"]),
                data.get("patient_name", existing["patient_name"]),
                data.get("consent_type", existing["consent_type"]),
                data.get("signed_by", existing["signed_by"]),
                data.get("relation_to_patient", existing["relation_to_patient"]),
                data.get("status", existing["status"]),
                data.get("notes", existing["notes"]),
                consent_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def create_insurance_verification(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO insurance_verifications (
                patient_id, patient_name, insurer_name, policy_number, member_id,
                verification_status, coverage_notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("patient_id"),
                data["patient_name"],
                data["insurer_name"],
                data.get("policy_number"),
                data.get("member_id"),
                data.get("verification_status", "pending"),
                data.get("coverage_notes"),
            ),
        )
        verification_id = cursor.lastrowid
        conn.commit()
        return verification_id


def list_insurance_verifications(patient_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if patient_id:
            cursor.execute(
                "SELECT * FROM insurance_verifications WHERE patient_id = ? ORDER BY checked_at DESC, id DESC",
                (patient_id,),
            )
        else:
            cursor.execute(
                "SELECT * FROM insurance_verifications ORDER BY checked_at DESC, id DESC"
            )
        return cursor.fetchall()


def update_insurance_verification(verification_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM insurance_verifications WHERE id = ?",
            (verification_id,),
        )
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE insurance_verifications
            SET patient_id = ?, patient_name = ?, insurer_name = ?, policy_number = ?,
                member_id = ?, verification_status = ?, coverage_notes = ?
            WHERE id = ?
            """,
            (
                data.get("patient_id", existing["patient_id"]),
                data.get("patient_name", existing["patient_name"]),
                data.get("insurer_name", existing["insurer_name"]),
                data.get("policy_number", existing["policy_number"]),
                data.get("member_id", existing["member_id"]),
                data.get("verification_status", existing["verification_status"]),
                data.get("coverage_notes", existing["coverage_notes"]),
                verification_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def create_certificate(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO certificates (
                patient_id, admission_id, certificate_type, title, body, issued_by
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                data["patient_id"],
                data.get("admission_id"),
                data["certificate_type"],
                data["title"],
                data["body"],
                data.get("issued_by"),
            ),
        )
        certificate_id = cursor.lastrowid
        conn.commit()
        return certificate_id


def list_certificates(patient_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM certificates WHERE patient_id = ? ORDER BY created_at DESC",
            (patient_id,),
        )
        return cursor.fetchall()


def delete_certificate(certificate_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM certificates WHERE id = ?", (certificate_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def create_ot_theatre(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO ot_theatres (
                theatre_code, theatre_name, equipment_notes, status
            ) VALUES (?, ?, ?, ?)
            """,
            (
                data["theatre_code"],
                data["theatre_name"],
                data.get("equipment_notes"),
                data.get("status", "available"),
            ),
        )
        theatre_id = cursor.lastrowid
        conn.commit()
        return theatre_id


def list_ot_theatres():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM ot_theatres ORDER BY theatre_code ASC")
        return cursor.fetchall()


def update_ot_theatre(theatre_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM ot_theatres WHERE id = ?", (theatre_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE ot_theatres
            SET theatre_code = ?, theatre_name = ?, equipment_notes = ?, status = ?
            WHERE id = ?
            """,
            (
                data.get("theatre_code", existing["theatre_code"]),
                data.get("theatre_name", existing["theatre_name"]),
                data.get("equipment_notes", existing["equipment_notes"]),
                data.get("status", existing["status"]),
                theatre_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_ot_theatre(theatre_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM ot_surgeries WHERE theatre_id = ?", (theatre_id,))
        cursor.execute("DELETE FROM ot_theatres WHERE id = ?", (theatre_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def create_ot_surgery(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO ot_surgeries (
                theatre_id, patient_id, procedure_name, surgeon_name, scheduled_start,
                estimated_duration_hours, status, equipment_required, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["theatre_id"],
                data.get("patient_id"),
                data["procedure_name"],
                data["surgeon_name"],
                data["scheduled_start"],
                data.get("estimated_duration_hours", 1),
                data.get("status", "scheduled"),
                data.get("equipment_required"),
                data.get("notes"),
            ),
        )
        surgery_id = cursor.lastrowid
        cursor.execute(
            "UPDATE ot_theatres SET status = CASE WHEN ? IN ('scheduled', 'in_progress') THEN 'occupied' ELSE status END WHERE id = ?",
            (data.get("status", "scheduled"), data["theatre_id"]),
        )
        conn.commit()
        return surgery_id


def list_ot_surgeries(theatre_id=None, status=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if theatre_id:
            clauses.append("theatre_id = ?")
            params.append(theatre_id)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(
            f"SELECT * FROM ot_surgeries{where_clause} ORDER BY scheduled_start ASC",
            tuple(params),
        )
        return cursor.fetchall()


def update_ot_surgery(surgery_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM ot_surgeries WHERE id = ?", (surgery_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        theatre_id = data.get("theatre_id", existing["theatre_id"])
        status = data.get("status", existing["status"])
        cursor.execute(
            """
            UPDATE ot_surgeries
            SET theatre_id = ?, patient_id = ?, procedure_name = ?, surgeon_name = ?,
                scheduled_start = ?, estimated_duration_hours = ?, status = ?,
                equipment_required = ?, notes = ?
            WHERE id = ?
            """,
            (
                theatre_id,
                data.get("patient_id", existing["patient_id"]),
                data.get("procedure_name", existing["procedure_name"]),
                data.get("surgeon_name", existing["surgeon_name"]),
                data.get("scheduled_start", existing["scheduled_start"]),
                data.get("estimated_duration_hours", existing["estimated_duration_hours"]),
                status,
                data.get("equipment_required", existing["equipment_required"]),
                data.get("notes", existing["notes"]),
                surgery_id,
            ),
        )
        cursor.execute(
            "UPDATE ot_theatres SET status = CASE WHEN ? IN ('scheduled', 'in_progress') THEN 'occupied' ELSE 'available' END WHERE id = ?",
            (status, theatre_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_ot_surgery(surgery_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT theatre_id FROM ot_surgeries WHERE id = ?", (surgery_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute("DELETE FROM ot_surgeries WHERE id = ?", (surgery_id,))
        cursor.execute(
            """
            UPDATE ot_theatres
            SET status = CASE
                WHEN EXISTS (
                    SELECT 1 FROM ot_surgeries
                    WHERE theatre_id = ? AND status IN ('scheduled', 'in_progress')
                ) THEN 'occupied'
                ELSE 'available'
            END
            WHERE id = ?
            """,
            (existing["theatre_id"], existing["theatre_id"]),
        )
        deleted = cursor.rowcount >= 0
        conn.commit()
        return deleted


def get_ot_summary():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS value FROM ot_theatres")
        theatre_count = cursor.fetchone()["value"]
        cursor.execute("SELECT COUNT(*) AS value FROM ot_theatres WHERE status = 'available'")
        available_count = cursor.fetchone()["value"]
        cursor.execute("SELECT COUNT(*) AS value FROM ot_surgeries WHERE status = 'scheduled'")
        scheduled_count = cursor.fetchone()["value"]
        cursor.execute("SELECT COUNT(*) AS value FROM ot_surgeries WHERE status = 'completed'")
        completed_count = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(estimated_duration_hours), 0) AS value FROM ot_surgeries WHERE status IN ('scheduled', 'in_progress')"
        )
        scheduled_hours = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(estimated_duration_hours), 0) AS value FROM ot_surgeries WHERE status = 'completed'"
        )
        completed_hours = cursor.fetchone()["value"]
        cursor.execute(
            """
            SELECT
                ot_theatres.theatre_code AS label,
                COALESCE(SUM(
                    CASE
                        WHEN ot_surgeries.status IN ('scheduled', 'in_progress', 'completed')
                        THEN ot_surgeries.estimated_duration_hours
                        ELSE 0
                    END
                ), 0) AS count
            FROM ot_theatres
            LEFT JOIN ot_surgeries ON ot_surgeries.theatre_id = ot_theatres.id
            GROUP BY ot_theatres.id, ot_theatres.theatre_code
            ORDER BY count DESC, ot_theatres.theatre_code ASC
            """
        )
        utilization = [dict(row) for row in cursor.fetchall()]
    return {
        "theatre_count": theatre_count,
        "available_theatres": available_count,
        "scheduled_surgeries": scheduled_count,
        "completed_surgeries": completed_count,
        "scheduled_hours": scheduled_hours,
        "completed_hours": completed_hours,
        "theatre_utilization": utilization,
    }


# ==================== Accounts operations ====================

def create_account_ledger_entry(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO accounts_ledger (
                entry_date, entry_type, category, reference_no, counterparty_name, amount, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["entry_date"],
                data.get("entry_type", "expense"),
                data["category"],
                data.get("reference_no"),
                data.get("counterparty_name"),
                float(data["amount"]),
                data.get("notes"),
            ),
        )
        entry_id = cursor.lastrowid
        conn.commit()
        return entry_id


def list_account_ledger_entries(entry_type=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if entry_type:
            cursor.execute(
                "SELECT * FROM accounts_ledger WHERE entry_type = ? ORDER BY entry_date DESC, id DESC",
                (entry_type,),
            )
        else:
            cursor.execute(
                "SELECT * FROM accounts_ledger ORDER BY entry_date DESC, id DESC"
            )
        return cursor.fetchall()


def update_account_ledger_entry(entry_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM accounts_ledger WHERE id = ?", (entry_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE accounts_ledger
            SET entry_date = ?, entry_type = ?, category = ?, reference_no = ?,
                counterparty_name = ?, amount = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("entry_date", existing["entry_date"]),
                data.get("entry_type", existing["entry_type"]),
                data.get("category", existing["category"]),
                data.get("reference_no", existing["reference_no"]),
                data.get("counterparty_name", existing["counterparty_name"]),
                float(data.get("amount", existing["amount"] or 0)),
                data.get("notes", existing["notes"]),
                entry_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_account_ledger_entry(entry_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM accounts_ledger WHERE id = ?", (entry_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def create_vendor_payment(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO vendor_payments (
                vendor_name, invoice_ref, amount, payment_date, payment_mode, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["vendor_name"],
                data.get("invoice_ref"),
                float(data["amount"]),
                data["payment_date"],
                data.get("payment_mode", "bank"),
                data.get("status", "paid"),
                data.get("notes"),
            ),
        )
        payment_id = cursor.lastrowid
        conn.commit()
        return payment_id


def list_vendor_payments(vendor_name=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if vendor_name:
            cursor.execute(
                "SELECT * FROM vendor_payments WHERE vendor_name = ? ORDER BY payment_date DESC, id DESC",
                (vendor_name,),
            )
        else:
            cursor.execute(
                "SELECT * FROM vendor_payments ORDER BY payment_date DESC, id DESC"
            )
        return cursor.fetchall()


def update_vendor_payment(payment_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vendor_payments WHERE id = ?", (payment_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE vendor_payments
            SET vendor_name = ?, invoice_ref = ?, amount = ?, payment_date = ?,
                payment_mode = ?, status = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("vendor_name", existing["vendor_name"]),
                data.get("invoice_ref", existing["invoice_ref"]),
                float(data.get("amount", existing["amount"] or 0)),
                data.get("payment_date", existing["payment_date"]),
                data.get("payment_mode", existing["payment_mode"]),
                data.get("status", existing["status"]),
                data.get("notes", existing["notes"]),
                payment_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_vendor_payment(payment_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM vendor_payments WHERE id = ?", (payment_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def create_doctor_payout(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        total_amount = float(data["amount"])
        paid_amount = float(data.get("paid_amount", 0))
        due_amount = max(total_amount - paid_amount, 0.0)
        status = data.get("status")
        if not status:
            status = "paid" if due_amount == 0 else ("partial" if paid_amount > 0 else "pending")
        cursor.execute(
            """
            INSERT INTO doctor_payouts (
                doctor_name, payout_month, amount, paid_amount, due_amount, status, paid_date, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["doctor_name"],
                data["payout_month"],
                total_amount,
                paid_amount,
                due_amount,
                status,
                data.get("paid_date"),
                data.get("notes"),
            ),
        )
        payout_id = cursor.lastrowid
        conn.commit()
        return payout_id


def list_doctor_payouts(doctor_name=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if doctor_name:
            cursor.execute(
                "SELECT * FROM doctor_payouts WHERE doctor_name = ? ORDER BY payout_month DESC, id DESC",
                (doctor_name,),
            )
        else:
            cursor.execute(
                "SELECT * FROM doctor_payouts ORDER BY payout_month DESC, id DESC"
            )
        return cursor.fetchall()


def update_doctor_payout(payout_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM doctor_payouts WHERE id = ?", (payout_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        total_amount = float(data.get("amount", existing["amount"] or 0))
        paid_amount = float(data.get("paid_amount", existing["paid_amount"] or 0))
        due_amount = max(total_amount - paid_amount, 0.0)
        status = data.get("status")
        if not status:
            status = "paid" if due_amount == 0 else ("partial" if paid_amount > 0 else "pending")
        cursor.execute(
            """
            UPDATE doctor_payouts
            SET doctor_name = ?, payout_month = ?, amount = ?, paid_amount = ?,
                due_amount = ?, status = ?, paid_date = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("doctor_name", existing["doctor_name"]),
                data.get("payout_month", existing["payout_month"]),
                total_amount,
                paid_amount,
                due_amount,
                status,
                data.get("paid_date", existing["paid_date"]),
                data.get("notes", existing["notes"]),
                payout_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_doctor_payout(payout_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM doctor_payouts WHERE id = ?", (payout_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def get_accounts_summary():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COALESCE(SUM(amount), 0) AS value FROM accounts_ledger WHERE entry_type = 'income'"
        )
        ledger_income = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(amount), 0) AS value FROM accounts_ledger WHERE entry_type = 'expense'"
        )
        ledger_expense = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(amount), 0) AS value FROM vendor_payments WHERE status IN ('partial', 'paid')"
        )
        vendor_paid = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(paid_amount), 0) AS value FROM doctor_payouts"
        )
        doctor_paid = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(due_amount), 0) AS value FROM doctor_payouts"
        )
        doctor_due = cursor.fetchone()["value"]
    return {
        "ledger_income": ledger_income,
        "ledger_expense": ledger_expense,
        "net_position": ledger_income - ledger_expense,
        "vendor_paid_total": vendor_paid,
        "doctor_paid_total": doctor_paid,
        "doctor_due_total": doctor_due,
    }


# ==================== HospAI module operations ====================

def create_encounter(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO encounters (
                patient_id, encounter_type, insurance_provider, insurance_policy_no,
                is_accident, referral_source, referral_name, status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["patient_id"],
                data.get("encounter_type", "OP"),
                data.get("insurance_provider"),
                data.get("insurance_policy_no"),
                1 if data.get("is_accident") else 0,
                data.get("referral_source"),
                data.get("referral_name"),
                data.get("status", "active"),
                data.get("created_by"),
            ),
        )
        encounter_id = cursor.lastrowid
        conn.commit()
        return encounter_id


def list_encounters(patient_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if patient_id:
            cursor.execute(
                "SELECT * FROM encounters WHERE patient_id = ? ORDER BY arrival_at DESC",
                (patient_id,),
            )
        else:
            cursor.execute("SELECT * FROM encounters ORDER BY arrival_at DESC")
        return cursor.fetchall()


def assign_bed(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO bed_allocations (
                admission_id, patient_id, ward, room_no, bed_no, status
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                data["admission_id"],
                data["patient_id"],
                data.get("ward"),
                data.get("room_no"),
                data.get("bed_no"),
                data.get("status", "active"),
            ),
        )
        bed_id = cursor.lastrowid
        conn.commit()
        return bed_id


def list_bed_allocations(patient_id=None, active_only=False):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if patient_id:
            lookup = str(patient_id).strip()
            clauses.append("(patient_id = ? OR patient_id LIKE ?)")
            params.extend([lookup, f"%{lookup}"])
        if active_only:
            clauses.append("status = 'active'")
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(f"SELECT * FROM bed_allocations{where_clause} ORDER BY allocated_at DESC", tuple(params))
        return cursor.fetchall()


def add_medication_schedule(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO medication_schedules (
                patient_id, medicine_name, dosage, schedule_time, administered, alert_enabled, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["patient_id"],
                data["medicine_name"],
                data.get("dosage"),
                data["schedule_time"],
                1 if data.get("administered") else 0,
                1 if data.get("alert_enabled", True) else 0,
                data.get("notes"),
            ),
        )
        schedule_id = cursor.lastrowid
        conn.commit()
        return schedule_id


def list_medication_schedules(patient_id, pending_only=False):
    with get_connection() as conn:
        cursor = conn.cursor()
        if pending_only:
            cursor.execute(
                """
                SELECT * FROM medication_schedules
                WHERE patient_id = ? AND administered = 0
                ORDER BY schedule_time ASC
                """,
                (patient_id,),
            )
        else:
            cursor.execute(
                """
                SELECT * FROM medication_schedules
                WHERE patient_id = ?
                ORDER BY schedule_time ASC
                """,
                (patient_id,),
            )
        return cursor.fetchall()


def add_observation_note(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO observation_notes (
                patient_id, admission_id, doctor_name, note, treatment_plan
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                data["patient_id"],
                data.get("admission_id"),
                data.get("doctor_name"),
                data["note"],
                data.get("treatment_plan"),
            ),
        )
        note_id = cursor.lastrowid
        conn.commit()
        return note_id


def list_observation_notes(patient_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM observation_notes WHERE patient_id = ? ORDER BY created_at DESC",
            (patient_id,),
        )
        return cursor.fetchall()


def add_patient_movement(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO patient_movements (
                patient_id, admission_id, from_department, to_department, moved_by
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                data["patient_id"],
                data.get("admission_id"),
                data.get("from_department"),
                data["to_department"],
                data.get("moved_by"),
            ),
        )
        movement_id = cursor.lastrowid
        conn.commit()
        return movement_id


def list_patient_movements(patient_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM patient_movements WHERE patient_id = ? ORDER BY moved_at DESC",
            (patient_id,),
        )
        return cursor.fetchall()


def create_invoice(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        paid_amount = float(data.get("paid_amount", 0) or 0)
        advance_amount = float(data.get("advance_amount", 0) or 0)
        refunded_amount = float(data.get("refunded_amount", 0) or 0)
        collected_amount = max(paid_amount + advance_amount - refunded_amount, 0.0)
        total_amount = float(data["total_amount"])
        due_amount = max(total_amount - collected_amount, 0.0)
        cursor.execute(
            """
            INSERT INTO invoices (
                invoice_no, patient_id, module, doctor_name, clinic_name, referral_source,
                subtotal, tax, discount, total_amount, paid_amount, due_amount, payment_status, created_by,
                advance_amount, refunded_amount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["invoice_no"],
                data.get("patient_id"),
                data["module"],
                data.get("doctor_name"),
                data.get("clinic_name"),
                data.get("referral_source"),
                data.get("subtotal", 0),
                data.get("tax", 0),
                data.get("discount", 0),
                total_amount,
                paid_amount,
                data.get("due_amount", due_amount),
                data.get("payment_status", "due"),
                data.get("created_by"),
                advance_amount,
                refunded_amount,
            ),
        )
        invoice_id = cursor.lastrowid

        # If module is Lab/Diagnostics, create diagnostic record
        module_upper = str(data.get("module") or "").upper()
        if module_upper in ["LAB", "DIAGNOSTICS", "DIAGNOSTIC"]:
            cursor.execute("SELECT id FROM diagnostics WHERE invoice_no = ?", (data["invoice_no"],))
            existing_diag = cursor.fetchone()
            if not existing_diag:
                # Fetch patient details
                patient_name = None
                age = None
                gender = None
                if data.get("patient_id"):
                    cursor.execute("SELECT name, middle_name, last_name, age, gender FROM patients WHERE patient_id = ?", (data["patient_id"],))
                    pat = cursor.fetchone()
                    if pat:
                        patient_name = " ".join(filter(None, [pat["name"], pat["middle_name"], pat["last_name"]]))
                        age = pat["age"]
                        gender = pat["gender"]
                
                # Compute discount and tax percentages
                disc_pct = float(data.get("discount", 0)) / max(total_amount, 1.0) * 100.0 if total_amount > 0 else 0.0
                tax_pct = float(data.get("tax", 0)) / max(total_amount - float(data.get("discount", 0)), 1.0) * 100.0 if (total_amount - float(data.get("discount", 0))) > 0 else 0.0

                from datetime import datetime
                cursor.execute(
                    """
                    INSERT INTO diagnostics (
                        invoice_no, patient_id, test_name, amount, paid_amount, due_amount, status,
                        patient_name, age, gender, department, visit_type,
                        bill_date, payment_mode, transaction_id,
                        discount_percentage, discount_amount, tax_percentage, tax_amount, remarks
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        data["invoice_no"],
                        data.get("patient_id"),
                        f"{data.get('module')} services",
                        total_amount,
                        paid_amount,
                        due_amount,
                        data.get("payment_status", "due"),
                        patient_name,
                        age,
                        gender,
                        data.get("module"),
                        "OPD",
                        datetime.now().strftime("%Y-%m-%d"),
                        "Cash",
                        None,
                        disc_pct,
                        data.get("discount", 0),
                        tax_pct,
                        data.get("tax", 0),
                        data.get("referral_source") or "Created from Billing module"
                    )
                )

        conn.commit()
        return invoice_id


def list_invoices(patient_id=None, module=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if patient_id:
            clauses.append("patient_id = ?")
            params.append(patient_id)
        if module:
            clauses.append("module = ?")
            params.append(module)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(f"SELECT * FROM invoices{where_clause} ORDER BY created_at DESC", tuple(params))
        return cursor.fetchall()


def get_invoice_by_id(invoice_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,))
        return cursor.fetchone()


def update_invoice(invoice_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,))
        existing = cursor.fetchone()
        if not existing:
            return False

        total_amount = float(data.get("total_amount", existing["total_amount"] or 0))
        paid_amount = float(data.get("paid_amount", existing["paid_amount"] or 0))
        advance_amount = float(data.get("advance_amount", existing["advance_amount"] or 0))
        refunded_amount = float(data.get("refunded_amount", existing["refunded_amount"] or 0))
        collected_amount = max(paid_amount + advance_amount - refunded_amount, 0.0)
        due_amount = max(total_amount - collected_amount, 0.0)
        payment_status = data.get("payment_status")
        if not payment_status:
            if due_amount == 0:
                payment_status = "paid"
            elif paid_amount > 0:
                payment_status = "partial"
            else:
                payment_status = "due"

        module_name = str(data.get("module", existing["module"])).upper()

        cursor.execute(
            """
            UPDATE invoices
            SET patient_id = ?,
                module = ?,
                doctor_name = ?,
                clinic_name = ?,
                referral_source = ?,
                subtotal = ?,
                tax = ?,
                discount = ?,
                total_amount = ?,
                paid_amount = ?,
                due_amount = ?,
                payment_status = ?,
                advance_amount = ?,
                refunded_amount = ?
            WHERE id = ?
            """,
            (
                data.get("patient_id", existing["patient_id"]),
                module_name,
                data.get("doctor_name", existing["doctor_name"]),
                data.get("clinic_name", existing["clinic_name"]),
                data.get("referral_source", existing["referral_source"]),
                data.get("subtotal", existing["subtotal"]),
                data.get("tax", existing["tax"]),
                data.get("discount", existing["discount"]),
                total_amount,
                paid_amount,
                due_amount,
                payment_status,
                advance_amount,
                refunded_amount,
                invoice_id,
            ),
        )
        updated = cursor.rowcount > 0
        if module_name in ["LAB", "DIAGNOSTICS", "DIAGNOSTIC"]:
            cursor.execute(
                """
                UPDATE diagnostics
                SET paid_amount = ?, due_amount = ?, status = ?, amount = ?
                WHERE invoice_no = ?
                """,
                (paid_amount, due_amount, payment_status, total_amount, existing["invoice_no"]),
            )
        conn.commit()
        return updated


def delete_invoice(invoice_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT invoice_no FROM invoices WHERE id = ?", (invoice_id,))
        inv = cursor.fetchone()
        if inv and inv["invoice_no"]:
            cursor.execute("DELETE FROM diagnostics WHERE invoice_no = ?", (inv["invoice_no"],))
        cursor.execute("DELETE FROM invoice_payments WHERE invoice_id = ?", (invoice_id,))
        cursor.execute("DELETE FROM invoices WHERE id = ?", (invoice_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def record_invoice_payment(invoice_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT total_amount, paid_amount, advance_amount, refunded_amount FROM invoices WHERE id = ?",
            (invoice_id,),
        )
        invoice = cursor.fetchone()
        if not invoice:
            return None

        amount = float(data["amount"])
        paid_total = float(invoice["paid_amount"] or 0) + amount
        total_amount = float(invoice["total_amount"] or 0)
        advance_amount = float(invoice["advance_amount"] or 0)
        refunded_amount = float(invoice["refunded_amount"] or 0)
        due_total = max(total_amount - max(paid_total + advance_amount - refunded_amount, 0.0), 0.0)
        if due_total == 0:
            status = "paid"
        elif paid_total > 0:
            status = "partial"
        else:
            status = "due"

        cursor.execute(
            """
            INSERT INTO invoice_payments (
                invoice_id, amount, payment_mode, gateway_ref, converted_from_mode, converted_to_mode
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                invoice_id,
                amount,
                data["payment_mode"],
                data.get("gateway_ref"),
                data.get("converted_from_mode"),
                data.get("converted_to_mode"),
            ),
        )
        payment_id = cursor.lastrowid
        cursor.execute(
            """
            UPDATE invoices
            SET paid_amount = ?, due_amount = ?, payment_status = ?
            WHERE id = ?
            """,
            (paid_total, due_total, status, invoice_id),
        )
        
        # Get invoice_no and module to update corresponding diagnostics record if needed
        cursor.execute("SELECT invoice_no, module FROM invoices WHERE id = ?", (invoice_id,))
        inv = cursor.fetchone()
        if inv:
            module_upper = str(inv["module"] or "").upper()
            if module_upper in ["LAB", "DIAGNOSTICS", "DIAGNOSTIC"]:
                cursor.execute(
                    """
                    UPDATE diagnostics
                    SET paid_amount = ?, due_amount = ?, status = ?, payment_mode = ?
                    WHERE invoice_no = ?
                    """,
                    (paid_total, due_total, status, data["payment_mode"], inv["invoice_no"]),
                )
                
        conn.commit()
        return payment_id


def create_insurance_claim(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO insurance_claims (
                invoice_id, patient_id, insurer_name, claim_amount, approved_amount,
                claim_status, external_ref, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["invoice_id"],
                data.get("patient_id"),
                data["insurer_name"],
                float(data["claim_amount"]),
                float(data.get("approved_amount", 0)),
                data.get("claim_status", "submitted"),
                data.get("external_ref"),
                data.get("notes"),
            ),
        )
        claim_id = cursor.lastrowid
        conn.commit()
        return claim_id


def list_insurance_claims(invoice_id=None, status=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if invoice_id:
            clauses.append("invoice_id = ?")
            params.append(invoice_id)
        if status:
            clauses.append("claim_status = ?")
            params.append(status)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(
            f"SELECT * FROM insurance_claims{where_clause} ORDER BY submitted_at DESC, id DESC",
            tuple(params),
        )
        return cursor.fetchall()


def update_insurance_claim(claim_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM insurance_claims WHERE id = ?", (claim_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE insurance_claims
            SET invoice_id = ?, patient_id = ?, insurer_name = ?, claim_amount = ?,
                approved_amount = ?, claim_status = ?, external_ref = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("invoice_id", existing["invoice_id"]),
                data.get("patient_id", existing["patient_id"]),
                data.get("insurer_name", existing["insurer_name"]),
                float(data.get("claim_amount", existing["claim_amount"] or 0)),
                float(data.get("approved_amount", existing["approved_amount"] or 0)),
                data.get("claim_status", existing["claim_status"]),
                data.get("external_ref", existing["external_ref"]),
                data.get("notes", existing["notes"]),
                claim_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_insurance_claim(claim_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM insurance_claims WHERE id = ?", (claim_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


PAYMENT_MODE_LABELS = {
    "cash": "Cash",
    "card": "Card",
    "upi": "UPI",
    "bank": "Bank Transfer",
}
PAYMENT_MODE_ORDER = ["Cash", "Card", "UPI", "Bank Transfer"]


def normalize_payment_mode_breakdown(rows):
    totals = {label: 0 for label in PAYMENT_MODE_ORDER}
    for row in rows or []:
        raw_label = str(row.get("label") or "cash").strip().lower()
        label = PAYMENT_MODE_LABELS.get(raw_label, raw_label.title() if raw_label else "Cash")
        totals[label] = totals.get(label, 0) + float(row.get("count") or 0)
    ordered = [{"label": label, "count": totals.get(label, 0)} for label in PAYMENT_MODE_ORDER]
    extras = [
        {"label": label, "count": amount}
        for label, amount in totals.items()
        if label not in PAYMENT_MODE_ORDER
    ]
    extras.sort(key=lambda item: item["label"])
    return ordered + extras


def get_revenue_summary(collection_date=None, collection_month=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if collection_month:
            try:
                month_start = datetime.strptime(str(collection_month)[:7] + "-01", "%Y-%m-%d").date()
                if month_start.month == 12:
                    next_month = month_start.replace(year=month_start.year + 1, month=1)
                else:
                    next_month = month_start.replace(month=month_start.month + 1)
                month_end = next_month.isoformat()
                month_start = month_start.isoformat()
            except ValueError:
                month_start = None
                month_end = None
        else:
            month_start = None
            month_end = None

        if collection_month and month_start and month_end:
            invoice_date_clause = " WHERE DATE(created_at) >= DATE(?) AND DATE(created_at) < DATE(?)"
            payment_date_clause = " WHERE DATE(created_at) >= DATE(?) AND DATE(created_at) < DATE(?)"
            diagnostic_date_clause = " WHERE DATE(created_at) >= DATE(?) AND DATE(created_at) < DATE(?)"
            pharmacy_date_clause = " WHERE DATE(sold_at) >= DATE(?) AND DATE(sold_at) < DATE(?)"
            invoice_params = (month_start, month_end)
            payment_params = (month_start, month_end)
            diagnostic_params = (month_start, month_end)
            pharmacy_params = (month_start, month_end)
        else:
            invoice_date_clause = " WHERE DATE(created_at) = DATE(?)" if collection_date else ""
            payment_date_clause = " WHERE DATE(created_at) = DATE(?)" if collection_date else ""
            diagnostic_date_clause = " WHERE DATE(created_at) = DATE(?)" if collection_date else ""
            pharmacy_date_clause = " WHERE DATE(sold_at) = DATE(?)" if collection_date else ""
            invoice_params = (collection_date,) if collection_date else ()
            payment_params = (collection_date,) if collection_date else ()
            diagnostic_params = (collection_date,) if collection_date else ()
            pharmacy_params = (collection_date,) if collection_date else ()
        cursor.execute(
            f"""
            SELECT COALESCE(SUM(value), 0) AS value
            FROM (
                SELECT COALESCE(SUM(total_amount), 0) AS value FROM invoices{invoice_date_clause}
                UNION ALL
                SELECT COALESCE(SUM(amount), 0) AS value FROM diagnostics{diagnostic_date_clause}
                UNION ALL
                SELECT COALESCE(SUM(amount), 0) AS value FROM pharmacy_sales{pharmacy_date_clause}
            )
            """,
            invoice_params + diagnostic_params + pharmacy_params,
        )
        total_billed = cursor.fetchone()["value"]
        if collection_date or (collection_month and month_start and month_end):
            cursor.execute(
                f"""
                SELECT COALESCE(SUM(value), 0) AS value
                FROM (
                    SELECT COALESCE(SUM(amount), 0) AS value FROM invoice_payments{payment_date_clause}
                    UNION ALL
                    SELECT COALESCE(SUM(paid_amount), 0) AS value FROM diagnostics{diagnostic_date_clause}
                    UNION ALL
                    SELECT COALESCE(SUM(amount), 0) AS value FROM pharmacy_sales{pharmacy_date_clause}
                )
                """,
                payment_params + diagnostic_params + pharmacy_params,
            )
        else:
            cursor.execute(
                """
            SELECT COALESCE(SUM(value), 0) AS value
            FROM (
                SELECT COALESCE(SUM(paid_amount + advance_amount - refunded_amount), 0) AS value FROM invoices
                UNION ALL
                SELECT COALESCE(SUM(paid_amount), 0) AS value FROM diagnostics
                UNION ALL
                SELECT COALESCE(SUM(amount), 0) AS value FROM pharmacy_sales
            )
                """
            )
        total_collected = cursor.fetchone()["value"]
        cursor.execute(
            f"""
            SELECT COALESCE(SUM(value), 0) AS value
            FROM (
                SELECT COALESCE(SUM(due_amount), 0) AS value FROM invoices{invoice_date_clause}
                UNION ALL
                SELECT COALESCE(SUM(due_amount), 0) AS value FROM diagnostics{diagnostic_date_clause}
            )
            """,
            invoice_params + diagnostic_params,
        )
        total_due = cursor.fetchone()["value"]
        cursor.execute(f"SELECT COALESCE(SUM(advance_amount), 0) AS value FROM invoices{invoice_date_clause}", invoice_params)
        total_advance = cursor.fetchone()["value"]
        cursor.execute(f"SELECT COALESCE(SUM(refunded_amount), 0) AS value FROM invoices{invoice_date_clause}", invoice_params)
        total_refunded = cursor.fetchone()["value"]
        cursor.execute(
            f"""
            SELECT label, COALESCE(SUM(count), 0) AS count
            FROM (
                SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'cash') AS label,
                       COALESCE(SUM(amount), 0) AS count
                FROM invoice_payments{payment_date_clause}
                GROUP BY label
                UNION ALL
                SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'cash') AS label,
                       COALESCE(SUM(paid_amount), 0) AS count
                FROM diagnostics{diagnostic_date_clause}
                GROUP BY label
                UNION ALL
                SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'cash') AS label,
                       COALESCE(SUM(amount), 0) AS count
                FROM pharmacy_sales{pharmacy_date_clause}
                GROUP BY label
            )
            GROUP BY label
            ORDER BY count DESC
            """,
            payment_params + diagnostic_params + pharmacy_params,
        )
        by_mode = normalize_payment_mode_breakdown([dict(row) for row in cursor.fetchall()])
        if collection_date or (collection_month and month_start and month_end):
            if collection_month and month_start and month_end:
                module_where = "DATE(ip.created_at) >= DATE(?) AND DATE(ip.created_at) < DATE(?)"
                diag_where = "DATE(created_at) >= DATE(?) AND DATE(created_at) < DATE(?)"
                pharm_where = "DATE(sold_at) >= DATE(?) AND DATE(sold_at) < DATE(?)"
                module_params = (month_start, month_end, month_start, month_end, month_start, month_end)
            else:
                module_where = "DATE(ip.created_at) = DATE(?)"
                diag_where = "DATE(created_at) = DATE(?)"
                pharm_where = "DATE(sold_at) = DATE(?)"
                module_params = (collection_date, collection_date, collection_date)
            cursor.execute(
                f"""
                SELECT label, COALESCE(SUM(count), 0) AS count
                FROM (
                    SELECT CASE
                               WHEN LOWER(COALESCE(i.module, '')) LIKE '%op%'
                                    OR LOWER(COALESCE(i.module, '')) LIKE '%consult%'
                                    OR LOWER(COALESCE(i.module, '')) LIKE '%billing%'
                               THEN 'OP / Billing'
                               ELSE COALESCE(NULLIF(TRIM(i.module), ''), 'Billing')
                           END AS label,
                           COALESCE(SUM(ip.amount), 0) AS count
                    FROM invoice_payments ip
                    JOIN invoices i ON i.id = ip.invoice_id
                    WHERE {module_where}
                    GROUP BY label
                    UNION ALL
                    SELECT 'Lab / Diagnostics' AS label,
                           COALESCE(SUM(paid_amount), 0) AS count
                    FROM diagnostics
                    WHERE {diag_where}
                    UNION ALL
                    SELECT 'Pharmacy' AS label,
                           COALESCE(SUM(amount), 0) AS count
                    FROM pharmacy_sales
                    WHERE {pharm_where}
                )
                GROUP BY label
                HAVING COALESCE(SUM(count), 0) > 0
                ORDER BY count DESC
                """,
                module_params,
            )
        else:
            cursor.execute(
                """
            SELECT label, COALESCE(SUM(count), 0) AS count
            FROM (
                SELECT CASE
                           WHEN LOWER(COALESCE(module, '')) LIKE '%op%'
                                OR LOWER(COALESCE(module, '')) LIKE '%consult%'
                                OR LOWER(COALESCE(module, '')) LIKE '%billing%'
                           THEN 'OP / Billing'
                           ELSE COALESCE(NULLIF(TRIM(module), ''), 'Billing')
                       END AS label,
                       COALESCE(SUM(paid_amount + advance_amount - refunded_amount), 0) AS count
                FROM invoices
                GROUP BY label
                UNION ALL
                SELECT 'Lab / Diagnostics' AS label,
                       COALESCE(SUM(paid_amount), 0) AS count
                FROM diagnostics
                UNION ALL
                SELECT 'Pharmacy' AS label,
                       COALESCE(SUM(amount), 0) AS count
                FROM pharmacy_sales
            )
            GROUP BY label
            HAVING COALESCE(SUM(count), 0) > 0
            ORDER BY count DESC
                """
            )
        by_module = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN due_amount > 0 AND CURRENT_TIMESTAMP - created_at < INTERVAL '31 days' THEN due_amount ELSE 0 END), 0) AS bucket_0_30,
                COALESCE(SUM(CASE WHEN due_amount > 0 AND CURRENT_TIMESTAMP - created_at >= INTERVAL '31 days' AND CURRENT_TIMESTAMP - created_at < INTERVAL '61 days' THEN due_amount ELSE 0 END), 0) AS bucket_31_60,
                COALESCE(SUM(CASE WHEN due_amount > 0 AND CURRENT_TIMESTAMP - created_at >= INTERVAL '61 days' AND CURRENT_TIMESTAMP - created_at < INTERVAL '91 days' THEN due_amount ELSE 0 END), 0) AS bucket_61_90,
                COALESCE(SUM(CASE WHEN due_amount > 0 AND CURRENT_TIMESTAMP - created_at >= INTERVAL '91 days' THEN due_amount ELSE 0 END), 0) AS bucket_91_plus
            FROM invoices
            """
        )
        aging = dict(cursor.fetchone() or {})

        cursor.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN gateway_ref IS NOT NULL AND TRIM(gateway_ref) <> '' THEN amount ELSE 0 END), 0) AS gateway_collected,
                COALESCE(SUM(CASE WHEN converted_from_mode IS NOT NULL AND TRIM(converted_from_mode) <> '' THEN amount ELSE 0 END), 0) AS converted_total
            FROM invoice_payments
            """
        )
        reconciliation = dict(cursor.fetchone() or {})

        cursor.execute(
            """
            SELECT
                COALESCE(NULLIF(TRIM(converted_from_mode), ''), payment_mode) || ' -> ' ||
                COALESCE(NULLIF(TRIM(converted_to_mode), ''), payment_mode) AS label,
                COALESCE(SUM(amount), 0) AS count
            FROM invoice_payments
            WHERE converted_from_mode IS NOT NULL AND TRIM(converted_from_mode) <> ''
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
        )
        conversion_breakdown = [dict(row) for row in cursor.fetchall()]

        if collection_month and month_start and month_end:
            doctor_payout_clause = " WHERE DATE(COALESCE(paid_date, created_at)) >= DATE(?) AND DATE(COALESCE(paid_date, created_at)) < DATE(?)"
            doctor_payout_params = (month_start, month_end)
        elif collection_date:
            doctor_payout_clause = " WHERE DATE(COALESCE(paid_date, created_at)) = DATE(?)"
            doctor_payout_params = (collection_date,)
        else:
            doctor_payout_clause = ""
            doctor_payout_params = ()

        cursor.execute(
            f"""
            SELECT COALESCE(SUM(
                CASE
                    WHEN COALESCE(due_amount, 0) > 0 THEN due_amount
                    WHEN LOWER(COALESCE(status, '')) IN ('pending', 'partial') THEN GREATEST(COALESCE(amount, 0) - COALESCE(paid_amount, 0), 0)
                    ELSE 0
                END
            ), 0) AS value
            FROM doctor_payouts{doctor_payout_clause}
            """,
            doctor_payout_params,
        )
        doctor_payout_ready = cursor.fetchone()["value"]
    return {
        "total_billed": total_billed,
        "total_collected": total_collected,
        "total_due": total_due,
        "total_advance": total_advance,
        "total_refunded": total_refunded,
        "doctor_payout_ready": doctor_payout_ready,
        "payment_mode_breakdown": by_mode,
        "collections_by_module": by_module,
        "aging_buckets": {
            "bucket_0_30": aging.get("bucket_0_30", 0),
            "bucket_31_60": aging.get("bucket_31_60", 0),
            "bucket_61_90": aging.get("bucket_61_90", 0),
            "bucket_91_plus": aging.get("bucket_91_plus", 0),
        },
        "reconciliation_summary": {
            "gateway_collected": reconciliation.get("gateway_collected", 0),
            "converted_total": reconciliation.get("converted_total", 0),
        },
        "conversion_breakdown": conversion_breakdown,
    }


def get_report_patient_history(collection_date=None, filter_type=None, filter_value=None):
    if not filter_type or not filter_value:
        return []

    filter_value_lower = filter_value.strip().lower()
    
    with get_connection() as conn:
        cursor = conn.cursor()
        
        date_params = ()
        if collection_date:
            invoice_date_clause = "AND DATE(ip.created_at) = DATE(?)"
            diagnostic_date_clause = "AND DATE(d.created_at) = DATE(?)"
            pharmacy_date_clause = "AND DATE(ps.sold_at) = DATE(?)"
            date_params = (collection_date,)
        else:
            invoice_date_clause = ""
            diagnostic_date_clause = ""
            pharmacy_date_clause = ""
            
        results = []
        
        if filter_type == 'module':
            if filter_value_lower in ('op / billing', 'billing', 'op', 'ip'):
                query = f"""
                    SELECT i.patient_id, p.name, p.last_name, NULL AS fallback_name,
                           ip.created_at, i.module AS source, i.invoice_no AS reference,
                           ip.amount, ip.payment_mode
                    FROM invoice_payments ip
                    JOIN invoices i ON i.id = ip.invoice_id
                    LEFT JOIN patients p ON p.patient_id = i.patient_id
                    WHERE 1=1 {invoice_date_clause}
                """
                if filter_value_lower == 'op / billing':
                    query += """
                        AND (LOWER(COALESCE(i.module, '')) LIKE '%op%'
                          OR LOWER(COALESCE(i.module, '')) LIKE '%consult%'
                          OR LOWER(COALESCE(i.module, '')) LIKE '%billing%')
                    """
                else:
                    query += " AND LOWER(i.module) = ?"
                    date_params = date_params + (filter_value_lower,)
                    
                cursor.execute(query, date_params)
                results = [dict(row) for row in cursor.fetchall()]
                
            elif filter_value_lower in ('lab / diagnostics', 'lab', 'diagnostics'):
                query = f"""
                    SELECT d.patient_id, p.name, p.last_name, d.patient_name AS fallback_name,
                           d.created_at, 'Lab / Diagnostics' AS source, d.test_name AS reference,
                           d.paid_amount AS amount, d.payment_mode
                    FROM diagnostics d
                    LEFT JOIN patients p ON p.patient_id = d.patient_id
                    WHERE 1=1 {diagnostic_date_clause}
                """
                cursor.execute(query, date_params)
                results = [dict(row) for row in cursor.fetchall()]
                
            elif filter_value_lower == 'pharmacy':
                query = f"""
                    SELECT ps.patient_id, p.name, p.last_name, NULL AS fallback_name,
                           ps.sold_at AS created_at, 'Pharmacy' AS source, ps.medicine_name AS reference,
                           ps.amount, ps.payment_mode
                    FROM pharmacy_sales ps
                    LEFT JOIN patients p ON p.patient_id = ps.patient_id
                    WHERE 1=1 {pharmacy_date_clause}
                """
                cursor.execute(query, date_params)
                results = [dict(row) for row in cursor.fetchall()]
                
            else:
                query = f"""
                    SELECT i.patient_id, p.name, p.last_name, NULL AS fallback_name,
                           ip.created_at, i.module AS source, i.invoice_no AS reference,
                           ip.amount, ip.payment_mode
                    FROM invoice_payments ip
                    JOIN invoices i ON i.id = ip.invoice_id
                    LEFT JOIN patients p ON p.patient_id = i.patient_id
                    WHERE LOWER(i.module) = ? {invoice_date_clause}
                """
                params = (filter_value_lower,) + date_params
                cursor.execute(query, params)
                results = [dict(row) for row in cursor.fetchall()]
                
        elif filter_type == 'payment_mode':
            query1 = f"""
                SELECT i.patient_id, p.name, p.last_name, NULL AS fallback_name,
                       ip.created_at,
                       CASE
                           WHEN LOWER(COALESCE(i.module, '')) LIKE '%op%'
                                OR LOWER(COALESCE(i.module, '')) LIKE '%consult%'
                                OR LOWER(COALESCE(i.module, '')) LIKE '%billing%'
                           THEN 'OP / Billing'
                           ELSE COALESCE(NULLIF(TRIM(i.module), ''), 'Billing')
                       END AS source,
                       i.invoice_no AS reference, ip.amount, ip.payment_mode
                FROM invoice_payments ip
                JOIN invoices i ON i.id = ip.invoice_id
                LEFT JOIN patients p ON p.patient_id = i.patient_id
                WHERE COALESCE(NULLIF(TRIM(ip.payment_mode), ''), 'cash') = ? {invoice_date_clause}
            """
            query2 = f"""
                SELECT d.patient_id, p.name, p.last_name, d.patient_name AS fallback_name,
                       d.created_at, 'Lab / Diagnostics' AS source, d.test_name AS reference,
                       d.paid_amount AS amount, d.payment_mode
                FROM diagnostics d
                LEFT JOIN patients p ON p.patient_id = d.patient_id
                WHERE COALESCE(NULLIF(TRIM(d.payment_mode), ''), 'cash') = ? {diagnostic_date_clause}
            """
            query3 = f"""
                SELECT ps.patient_id, p.name, p.last_name, NULL AS fallback_name,
                       ps.sold_at AS created_at, 'Pharmacy' AS source, ps.medicine_name AS reference,
                       ps.amount, ps.payment_mode
                FROM pharmacy_sales ps
                LEFT JOIN patients p ON p.patient_id = ps.patient_id
                WHERE COALESCE(NULLIF(TRIM(ps.payment_mode), ''), 'cash') = ? {pharmacy_date_clause}
            """
            
            mode_map = {
                'cash': 'cash',
                'card': 'card',
                'upi': 'upi',
                'bank': 'bank',
                'net banking': 'bank',
                'wire transfer': 'bank'
            }
            db_mode = mode_map.get(filter_value_lower, filter_value_lower)
            
            p1 = (db_mode,) + date_params
            p2 = (db_mode,) + date_params
            p3 = (db_mode,) + date_params
            
            cursor.execute(query1, p1)
            r1 = [dict(row) for row in cursor.fetchall()]
            
            cursor.execute(query2, p2)
            r2 = [dict(row) for row in cursor.fetchall()]
            
            cursor.execute(query3, p3)
            r3 = [dict(row) for row in cursor.fetchall()]
            
            results = r1 + r2 + r3

        formatted_history = []
        for r in results:
            first_name = r.get("name")
            last_name = r.get("last_name")
            if first_name:
                pat_name = f"{first_name} {last_name or ''}".strip()
            else:
                pat_name = r.get("fallback_name") or "Walk-in Patient"
                
            formatted_history.append({
                "patient_id": r.get("patient_id") or "Walk-in",
                "patient_name": pat_name,
                "date": r.get("created_at").isoformat() if hasattr(r.get("created_at"), 'isoformat') else str(r.get("created_at") or ""),
                "source": r.get("source") or "Other",
                "reference": r.get("reference") or "-",
                "amount": float(r.get("amount") or 0.0),
                "payment_mode": str(r.get("payment_mode") or "cash").title()
            })
            
        formatted_history.sort(key=lambda x: x["date"], reverse=True)
        return formatted_history


def get_reports_overview():
    hospital_summary = get_hospital_dashboard_summary()
    billing_summary = get_revenue_summary()
    pharmacy_summary = get_pharmacy_summary()
    lab_summary = get_diagnostic_summary()
    employee_summary = get_employee_stats()
    accounts_summary = get_accounts_summary()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(doctor_name), ''), 'Unassigned') AS label,
                   COALESCE(SUM(paid_amount + advance_amount - refunded_amount), 0) AS count
            FROM invoices
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
        )
        doctor_income = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(patient_id), ''), 'Unknown') AS label,
                   COALESCE(SUM(total_amount), 0) AS total_billed,
                   COALESCE(SUM(due_amount), 0) AS total_due
            FROM invoices
            GROUP BY label
            ORDER BY total_due DESC, total_billed DESC, label ASC
            """
        )
        patient_financials = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(doctor_name), ''), 'Unassigned') AS label,
                   COALESCE(SUM(amount), 0) AS count
            FROM diagnostics
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
        )
        diagnostics_by_doctor = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(clinic_name), ''), 'General') AS label,
                   COALESCE(SUM(total_amount), 0) AS count
            FROM invoices
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
        )
        clinic_income = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(module), ''), 'UNKNOWN') AS label,
                   COALESCE(SUM(discount), 0) AS count
            FROM invoices
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
        )
        discount_by_module = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(payment_status), ''), 'due') AS label,
                   COUNT(*) AS count
            FROM invoices
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
        )
        payment_status_breakdown = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT AVG(
                GREATEST(
                    EXTRACT(EPOCH FROM (COALESCE(discharge_date::timestamp, CURRENT_TIMESTAMP) - admission_date)) / 86400.0,
                    0
                )
            ) AS avg_los,
            COUNT(*) AS admission_count
            FROM admissions
            """
        )
        alos_row = cursor.fetchone()
        average_los_days = round(float((alos_row or {"avg_los": 0})["avg_los"] or 0), 2)
        admission_count = int((alos_row or {"admission_count": 0})["admission_count"] or 0)

    return {
        "hospital_summary": hospital_summary,
        "billing_summary": billing_summary,
        "pharmacy_summary": pharmacy_summary,
        "lab_summary": lab_summary,
        "employee_summary": employee_summary,
        "accounts_summary": accounts_summary,
        "doctor_income": doctor_income,
        "patient_financials": patient_financials,
        "diagnostics_by_doctor": diagnostics_by_doctor,
        "clinic_income": clinic_income,
        "discount_by_module": discount_by_module,
        "payment_status_breakdown": payment_status_breakdown,
        "alos_summary": {
            "average_los_days": average_los_days,
            "admission_count": admission_count,
        },
    }


def upsert_inventory_item(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        item_id = data.get("id")
        if item_id:
            cursor.execute(
                """
                UPDATE pharmacy_inventory
                SET medicine_name=?, batch_no=?, quantity=?, reorder_level=?, unit_price=?, expiry_date=?, stock_condition=?, updated_at=CURRENT_TIMESTAMP
                WHERE id=?
                """,
                (
                    data["medicine_name"],
                    data.get("batch_no"),
                    data.get("quantity", 0),
                    data.get("reorder_level", 10),
                    data.get("unit_price", 0),
                    data.get("expiry_date"),
                    data.get("stock_condition", "proper"),
                    item_id,
                ),
            )
            conn.commit()
            return item_id
        cursor.execute(
            """
            INSERT INTO pharmacy_inventory (
                medicine_name, batch_no, quantity, reorder_level, unit_price, expiry_date, stock_condition
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["medicine_name"],
                data.get("batch_no"),
                data.get("quantity", 0),
                data.get("reorder_level", 10),
                data.get("unit_price", 0),
                data.get("expiry_date"),
                data.get("stock_condition", "proper"),
            ),
        )
        item_id = cursor.lastrowid
        conn.commit()
        return item_id


def list_inventory_items():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pharmacy_inventory ORDER BY medicine_name ASC")
        return cursor.fetchall()


def delete_inventory_item(item_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM pharmacy_inventory WHERE id = ?", (item_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def create_pharmacy_supplier(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO pharmacy_suppliers (supplier_name, contact_person, phone, status)
            VALUES (?, ?, ?, ?)
            """,
            (
                data["supplier_name"],
                data.get("contact_person"),
                data.get("phone"),
                data.get("status", "active"),
            ),
        )
        supplier_id = cursor.lastrowid
        conn.commit()
        return supplier_id


def list_pharmacy_suppliers():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pharmacy_suppliers ORDER BY supplier_name ASC")
        return cursor.fetchall()


def update_pharmacy_supplier(supplier_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pharmacy_suppliers WHERE id = ?", (supplier_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE pharmacy_suppliers
            SET supplier_name = ?, contact_person = ?, phone = ?, status = ?
            WHERE id = ?
            """,
            (
                data.get("supplier_name", existing["supplier_name"]),
                data.get("contact_person", existing["contact_person"]),
                data.get("phone", existing["phone"]),
                data.get("status", existing["status"]),
                supplier_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_pharmacy_supplier(supplier_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE pharmacy_purchases SET supplier_id = NULL WHERE supplier_id = ?", (supplier_id,))
        cursor.execute("DELETE FROM pharmacy_suppliers WHERE id = ?", (supplier_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def _apply_purchase_inventory(cursor, medicine_name, quantity):
    cursor.execute("SELECT id, quantity FROM pharmacy_inventory WHERE medicine_name = ?", (medicine_name,))
    existing_inventory = cursor.fetchone()
    if existing_inventory:
        cursor.execute(
            """
            UPDATE pharmacy_inventory
            SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (quantity, existing_inventory["id"]),
        )
    else:
        cursor.execute(
            """
            INSERT INTO pharmacy_inventory (
                medicine_name, quantity, reorder_level, unit_price, stock_condition
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (medicine_name, quantity, 10, 0, "proper"),
        )


def create_pharmacy_purchase(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        quantity = int(data["quantity"])
        unit_cost = float(data["unit_cost"])
        status = data.get("status", "ordered")
        stock_applied = 1 if status == "received" else 0
        cursor.execute(
            """
            INSERT INTO pharmacy_purchases (
                supplier_id, medicine_name, quantity, unit_cost, total_cost, status,
                expected_date, received_date, stock_applied
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("supplier_id"),
                data["medicine_name"],
                quantity,
                unit_cost,
                quantity * unit_cost,
                status,
                data.get("expected_date"),
                data.get("received_date"),
                stock_applied,
            ),
        )
        purchase_id = cursor.lastrowid
        if stock_applied:
            _apply_purchase_inventory(cursor, data["medicine_name"], quantity)
        conn.commit()
        return purchase_id


def list_pharmacy_purchases(status=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if status:
            cursor.execute(
                "SELECT * FROM pharmacy_purchases WHERE status = ? ORDER BY created_at DESC, id DESC",
                (status,),
            )
        else:
            cursor.execute("SELECT * FROM pharmacy_purchases ORDER BY created_at DESC, id DESC")
        return cursor.fetchall()


def update_pharmacy_purchase(purchase_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pharmacy_purchases WHERE id = ?", (purchase_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        quantity = int(data.get("quantity", existing["quantity"] or 0))
        unit_cost = float(data.get("unit_cost", existing["unit_cost"] or 0))
        status = data.get("status", existing["status"])
        stock_applied = int(existing["stock_applied"] or 0)
        cursor.execute(
            """
            UPDATE pharmacy_purchases
            SET supplier_id = ?, medicine_name = ?, quantity = ?, unit_cost = ?, total_cost = ?,
                status = ?, expected_date = ?, received_date = ?, stock_applied = ?
            WHERE id = ?
            """,
            (
                data.get("supplier_id", existing["supplier_id"]),
                data.get("medicine_name", existing["medicine_name"]),
                quantity,
                unit_cost,
                quantity * unit_cost,
                status,
                data.get("expected_date", existing["expected_date"]),
                data.get("received_date", existing["received_date"]),
                stock_applied,
                purchase_id,
            ),
        )
        if status == "received" and not stock_applied:
            _apply_purchase_inventory(cursor, data.get("medicine_name", existing["medicine_name"]), quantity)
            cursor.execute(
                "UPDATE pharmacy_purchases SET stock_applied = 1 WHERE id = ?",
                (purchase_id,),
            )
        conn.commit()
        return cursor.rowcount > 0


def delete_pharmacy_purchase(purchase_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM pharmacy_purchases WHERE id = ?", (purchase_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def create_pharmacy_sale(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        amount = float(data["quantity"]) * float(data["unit_price"])
        cursor.execute(
            """
            INSERT INTO pharmacy_sales (
                invoice_id, patient_id, prescription_ref, medicine_name, quantity, unit_price, amount, payment_mode
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("invoice_id"),
                data.get("patient_id"),
                data.get("prescription_ref"),
                data["medicine_name"],
                data["quantity"],
                data["unit_price"],
                amount,
                data.get("payment_mode", "cash"),
            ),
        )
        sale_id = cursor.lastrowid
        cursor.execute(
            """
            UPDATE pharmacy_inventory
            SET quantity = CASE WHEN quantity >= ? THEN quantity - ? ELSE 0 END, updated_at=CURRENT_TIMESTAMP
            WHERE medicine_name = ?
            """,
            (data["quantity"], data["quantity"], data["medicine_name"]),
        )
        conn.commit()
        return sale_id


def list_pharmacy_sales(medicine_name=None, invoice_id=None, patient_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if medicine_name:
            clauses.append("medicine_name = ?")
            params.append(medicine_name)
        if invoice_id:
            clauses.append("invoice_id = ?")
            params.append(invoice_id)
        if patient_id:
            clauses.append("patient_id = ?")
            params.append(patient_id)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(
            f"SELECT * FROM pharmacy_sales{where_clause} ORDER BY sold_at DESC",
            tuple(params),
        )
        return cursor.fetchall()


def get_pharmacy_summary():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT COUNT(*) AS value
            FROM pharmacy_inventory
            WHERE quantity <= reorder_level
            """
        )
        low_stock = cursor.fetchone()["value"]
        cursor.execute(
            """
            SELECT COUNT(*) AS value
            FROM pharmacy_inventory
            WHERE quantity = 0
            """
        )
        out_of_stock = cursor.fetchone()["value"]
        cursor.execute(
            """
            SELECT COUNT(*) AS value
            FROM pharmacy_inventory
            WHERE stock_condition = 'damaged'
            """
        )
        damaged = cursor.fetchone()["value"]
        cursor.execute("SELECT COALESCE(SUM(amount), 0) AS value FROM pharmacy_sales")
        sales_total = cursor.fetchone()["value"]
    return {
        "low_stock_count": low_stock,
        "out_of_stock_count": out_of_stock,
        "damaged_stock_count": damaged,
        "sales_total": sales_total,
    }


def create_lab_vendor(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO lab_vendors (vendor_name, contact_person, phone, status)
            VALUES (?, ?, ?, ?)
            """,
            (
                data["vendor_name"],
                data.get("contact_person"),
                data.get("phone"),
                data.get("status", "active"),
            ),
        )
        vendor_id = cursor.lastrowid
        conn.commit()
        return vendor_id


def list_lab_vendors():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM lab_vendors ORDER BY vendor_name ASC")
        return cursor.fetchall()


def update_lab_vendor(vendor_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM lab_vendors WHERE id = ?", (vendor_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE lab_vendors
            SET vendor_name = ?, contact_person = ?, phone = ?, status = ?
            WHERE id = ?
            """,
            (
                data.get("vendor_name", existing["vendor_name"]),
                data.get("contact_person", existing["contact_person"]),
                data.get("phone", existing["phone"]),
                data.get("status", existing["status"]),
                vendor_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_lab_vendor(vendor_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE diagnostics SET vendor_id = NULL WHERE vendor_id = ?", (vendor_id,))
        cursor.execute("DELETE FROM lab_vendors WHERE id = ?", (vendor_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def _diagnostic_amounts(data, existing=None):
    def _number(value, fallback=0):
        try:
            if value is None or value == "":
                return float(fallback or 0)
            return float(value)
        except (TypeError, ValueError):
            return float(fallback or 0)

    existing = existing or {}
    gross_amount = _number(data.get("amount"), (existing["amount"] if existing and "amount" in existing.keys() else 0))
    discount_percentage = _number(data.get("discount_percentage"), (existing["discount_percentage"] if existing and "discount_percentage" in existing.keys() else 0))
    discount_amount = _number(data.get("discount_amount"), (existing["discount_amount"] if existing and "discount_amount" in existing.keys() else 0))
    if discount_percentage and not discount_amount:
        discount_amount = round(gross_amount * discount_percentage / 100, 2)
    discount_amount = min(max(discount_amount, 0), gross_amount)

    taxable_amount = max(gross_amount - discount_amount, 0)
    tax_percentage = _number(data.get("tax_percentage"), (existing["tax_percentage"] if existing and "tax_percentage" in existing.keys() else 0))
    tax_amount = _number(data.get("tax_amount"), (existing["tax_amount"] if existing and "tax_amount" in existing.keys() else 0))
    if tax_percentage and not tax_amount:
        tax_amount = round(taxable_amount * tax_percentage / 100, 2)

    net_amount = round(max(taxable_amount + tax_amount, 0), 2)
    paid_amount = _number(data.get("paid_amount"), (existing["paid_amount"] if existing and "paid_amount" in existing.keys() else 0))
    paid_amount = min(max(paid_amount, 0), net_amount)
    due_amount = round(max(net_amount - paid_amount, 0), 2)
    status = "paid" if due_amount == 0 else ("partial" if paid_amount > 0 else "due")
    return net_amount, paid_amount, due_amount, status, discount_percentage, discount_amount, tax_percentage, tax_amount


def _blank_to_none(value):
    """Convert empty strings to None so PostgreSQL DATE/TIMESTAMP columns don't fail."""
    if value == "" or value is None:
        return None
    return value


def create_diagnostic_record(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        total_amount, paid_amount, due_amount, status, discount_percentage, discount_amount, tax_percentage, tax_amount = _diagnostic_amounts(data)
        cursor.execute(
            """
            INSERT INTO diagnostics (
                invoice_no, patient_id, vendor_id, doctor_name, test_name, amount, paid_amount, due_amount, status,
                sample_barcode, order_status, collected_at, reported_at,
                patient_name, age, gender, department, visit_type, visit_id,
                bill_date, due_date, payment_mode, transaction_id,
                discount_percentage, discount_amount, tax_percentage, tax_amount,
                report_delivery_mode, report_delivery_date, remarks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, ?,
                     ?, ?, ?, ?,
                     ?, ?, ?)
            """,
            (
                data.get("invoice_no"),
                data.get("patient_id"),
                data.get("vendor_id"),
                data.get("doctor_name"),
                data["test_name"],
                total_amount,
                paid_amount,
                due_amount,
                status,
                data.get("sample_barcode"),
                data.get("order_status", "ordered"),
                data.get("collected_at"),
                data.get("reported_at"),
                data.get("patient_name"),
                data.get("age"),
                data.get("gender"),
                _blank_to_none(data.get("department")),
                _blank_to_none(data.get("visit_type")),
                _blank_to_none(data.get("visit_id")),
                _blank_to_none(data.get("bill_date")),
                _blank_to_none(data.get("due_date")),
                _blank_to_none(data.get("payment_mode")),
                _blank_to_none(data.get("transaction_id")),
                discount_percentage,
                discount_amount,
                tax_percentage,
                tax_amount,
                _blank_to_none(data.get("report_delivery_mode")),
                _blank_to_none(data.get("report_delivery_date")),
                _blank_to_none(data.get("remarks")),
            ),
        )
        diagnostic_id = cursor.lastrowid

        # Automatically insert corresponding global billing invoice if it doesn't exist
        invoice_no = data.get("invoice_no")
        if invoice_no:
            cursor.execute("SELECT id FROM invoices WHERE invoice_no = ?", (invoice_no,))
            existing_inv = cursor.fetchone()
            if not existing_inv:
                cursor.execute(
                    """
                    INSERT INTO invoices (
                        invoice_no, patient_id, module, doctor_name, clinic_name, referral_source,
                        subtotal, tax, discount, total_amount, paid_amount, due_amount, payment_status, created_by,
                        advance_amount, refunded_amount
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        invoice_no,
                        data.get("patient_id"),
                        "LAB",
                        data.get("doctor_name"),
                        None,
                        data.get("remarks") or "Lab Billing",
                        data.get("amount", 0),
                        tax_amount,
                        discount_amount,
                        total_amount,
                        paid_amount,
                        due_amount,
                        status,
                        "System",
                        0.0,
                        0.0
                    )
                )

        conn.commit()
        return diagnostic_id


def list_diagnostics(patient_id=None, doctor_name=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if patient_id:
            clauses.append("patient_id = ?")
            params.append(patient_id)
        if doctor_name:
            clauses.append("doctor_name = ?")
            params.append(doctor_name)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(f"SELECT * FROM diagnostics{where_clause} ORDER BY created_at DESC", tuple(params))
        return cursor.fetchall()


def update_diagnostic_record(diagnostic_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM diagnostics WHERE id = ?", (diagnostic_id,))
        existing = cursor.fetchone()
        if not existing:
            return False

        def ex(column, default=None):
            try:
                return existing[column] if column in existing.keys() else default
            except Exception:
                return default

        total_amount, paid_amount, due_amount, computed_status, discount_percentage, discount_amount, tax_percentage, tax_amount = _diagnostic_amounts(data, existing)
        status = data.get("status") or computed_status

        cursor.execute(
            """
            UPDATE diagnostics
            SET invoice_no = ?,
                patient_id = ?,
                vendor_id = ?,
                doctor_name = ?,
                test_name = ?,
                amount = ?,
                paid_amount = ?,
                due_amount = ?,
                status = ?,
                sample_barcode = ?,
                order_status = ?,
                collected_at = ?,
                reported_at = ?,
                patient_name = ?,
                age = ?,
                gender = ?,
                department = ?,
                visit_type = ?,
                visit_id = ?,
                bill_date = ?,
                due_date = ?,
                payment_mode = ?,
                transaction_id = ?,
                discount_percentage = ?,
                discount_amount = ?,
                tax_percentage = ?,
                tax_amount = ?,
                report_delivery_mode = ?,
                report_delivery_date = ?,
                remarks = ?
            WHERE id = ?
            """,
            (
                data.get("invoice_no", existing["invoice_no"]),
                data.get("patient_id", existing["patient_id"]),
                data.get("vendor_id", existing["vendor_id"]),
                data.get("doctor_name", existing["doctor_name"]),
                data.get("test_name", existing["test_name"]),
                total_amount,
                paid_amount,
                due_amount,
                status,
                data.get("sample_barcode", existing["sample_barcode"]),
                data.get("order_status", existing["order_status"]),
                data.get("collected_at", existing["collected_at"]),
                data.get("reported_at", existing["reported_at"]),
                data.get("patient_name", ex("patient_name")),
                data.get("age", ex("age")),
                data.get("gender", ex("gender")),
                _blank_to_none(data.get("department", ex("department"))),
                _blank_to_none(data.get("visit_type", ex("visit_type"))),
                _blank_to_none(data.get("visit_id", ex("visit_id"))),
                _blank_to_none(data.get("bill_date", ex("bill_date"))),
                _blank_to_none(data.get("due_date", ex("due_date"))),
                _blank_to_none(data.get("payment_mode", ex("payment_mode"))),
                _blank_to_none(data.get("transaction_id", ex("transaction_id"))),
                discount_percentage,
                discount_amount,
                tax_percentage,
                tax_amount,
                _blank_to_none(data.get("report_delivery_mode", ex("report_delivery_mode"))),
                _blank_to_none(data.get("report_delivery_date", ex("report_delivery_date"))),
                _blank_to_none(data.get("remarks", ex("remarks"))),
                diagnostic_id,
            ),
        )
        # Update corresponding global billing invoice if it exists
        inv_no = data.get("invoice_no", existing["invoice_no"])
        if inv_no:
            cursor.execute(
                """
                UPDATE invoices
                SET paid_amount = ?, due_amount = ?, payment_status = ?, total_amount = ?, subtotal = ?, tax = ?, discount = ?
                WHERE invoice_no = ?
                """,
                (
                    paid_amount,
                    due_amount,
                    status,
                    total_amount,
                    data.get("amount", existing["amount"]),
                    tax_amount,
                    discount_amount,
                    inv_no
                )
            )
        conn.commit()
        return cursor.rowcount > 0


def delete_diagnostic_record(diagnostic_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT invoice_no FROM diagnostics WHERE id = ?", (diagnostic_id,))
        diag = cursor.fetchone()
        if diag and diag["invoice_no"]:
            cursor.execute("DELETE FROM invoices WHERE invoice_no = ?", (diag["invoice_no"],))
        cursor.execute("DELETE FROM diagnostics WHERE id = ?", (diagnostic_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def get_diagnostic_summary():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COALESCE(SUM(amount), 0) AS value FROM diagnostics")
        total_amount = cursor.fetchone()["value"]
        cursor.execute("SELECT COALESCE(SUM(paid_amount), 0) AS value FROM diagnostics")
        total_paid = cursor.fetchone()["value"]
        cursor.execute("SELECT COALESCE(SUM(due_amount), 0) AS value FROM diagnostics")
        total_due = cursor.fetchone()["value"]
    return {"total_amount": total_amount, "total_paid": total_paid, "total_due": total_due}


def create_department(data, hospital_id=None):
    scoped_hospital_id = hospital_id or data.get("hospital_id") or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO department_master (hospital_id, department_name, mapped_head_employee_id)
            VALUES (?, ?, ?)
            """,
            (scoped_hospital_id, data["department_name"], data.get("mapped_head_employee_id")),
        )
        department_id = cursor.lastrowid
        conn.commit()
        return department_id


def list_departments(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM department_master WHERE hospital_id = ? ORDER BY department_name ASC",
            (scoped_hospital_id,),
        )
        return cursor.fetchall()


def update_department(department_id, data, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM department_master WHERE id = ? AND hospital_id = ?",
            (department_id, scoped_hospital_id),
        )
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE department_master
            SET department_name = ?, mapped_head_employee_id = ?
            WHERE id = ? AND hospital_id = ?
            """,
            (
                data.get("department_name", existing["department_name"]),
                data.get("mapped_head_employee_id", existing["mapped_head_employee_id"]),
                department_id,
                scoped_hospital_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_department(department_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM department_master WHERE id = ? AND hospital_id = ?",
            (department_id, scoped_hospital_id),
        )
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def create_attendance(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO attendance (employee_id, attendance_date, status, in_time, out_time, notes)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                data["employee_id"],
                data["attendance_date"],
                data["status"],
                data.get("in_time"),
                data.get("out_time"),
                data.get("notes"),
            ),
        )
        attendance_id = cursor.lastrowid
        conn.commit()
        return attendance_id


def list_attendance(employee_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if employee_id:
            cursor.execute(
                "SELECT * FROM attendance WHERE employee_id = ? ORDER BY attendance_date DESC",
                (employee_id,),
            )
        else:
            cursor.execute("SELECT * FROM attendance ORDER BY attendance_date DESC")
        return cursor.fetchall()


def update_attendance_record(attendance_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM attendance WHERE id = ?", (attendance_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE attendance
            SET employee_id = ?, attendance_date = ?, status = ?, in_time = ?, out_time = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("employee_id", existing["employee_id"]),
                data.get("attendance_date", existing["attendance_date"]),
                data.get("status", existing["status"]),
                data.get("in_time", existing["in_time"]),
                data.get("out_time", existing["out_time"]),
                data.get("notes", existing["notes"]),
                attendance_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_attendance_record(attendance_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM attendance WHERE id = ?", (attendance_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def create_payroll_record(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        net_salary = float(data["basic_salary"]) + float(data.get("allowances", 0)) - float(data.get("deductions", 0))
        cursor.execute(
            """
            INSERT INTO payroll (
                employee_id, payroll_month, basic_salary, allowances, deductions, net_salary, paid_status, paid_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["employee_id"],
                data["payroll_month"],
                data["basic_salary"],
                data.get("allowances", 0),
                data.get("deductions", 0),
                net_salary,
                data.get("paid_status", "pending"),
                data.get("paid_date"),
            ),
        )
        payroll_id = cursor.lastrowid
        conn.commit()
        return payroll_id


def list_payroll(employee_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if employee_id:
            cursor.execute(
                "SELECT * FROM payroll WHERE employee_id = ? ORDER BY payroll_month DESC",
                (employee_id,),
            )
        else:
            cursor.execute("SELECT * FROM payroll ORDER BY payroll_month DESC")
        return cursor.fetchall()


def update_payroll_record(payroll_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM payroll WHERE id = ?", (payroll_id,))
        existing = cursor.fetchone()
        if not existing:
            return False

        basic_salary = float(data.get("basic_salary", existing["basic_salary"] or 0))
        allowances = float(data.get("allowances", existing["allowances"] or 0))
        deductions = float(data.get("deductions", existing["deductions"] or 0))
        net_salary = basic_salary + allowances - deductions

        cursor.execute(
            """
            UPDATE payroll
            SET employee_id = ?, payroll_month = ?, basic_salary = ?, allowances = ?, deductions = ?, net_salary = ?, paid_status = ?, paid_date = ?
            WHERE id = ?
            """,
            (
                data.get("employee_id", existing["employee_id"]),
                data.get("payroll_month", existing["payroll_month"]),
                basic_salary,
                allowances,
                deductions,
                net_salary,
                data.get("paid_status", existing["paid_status"]),
                data.get("paid_date", existing["paid_date"]),
                payroll_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_payroll_record(payroll_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM payroll WHERE id = ?", (payroll_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def create_leave_request(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO leave_requests (
                employee_id, leave_type, start_date, end_date, reason, status, decided_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["employee_id"],
                data["leave_type"],
                data["start_date"],
                data["end_date"],
                data.get("reason"),
                data.get("status", "pending"),
                data.get("decided_by"),
            ),
        )
        leave_id = cursor.lastrowid
        conn.commit()
        return leave_id


def update_leave_status(leave_id, status, decided_by=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE leave_requests SET status=?, decided_by=? WHERE id=?",
            (status, decided_by, leave_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def list_leave_requests(employee_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if employee_id:
            cursor.execute(
                "SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY created_at DESC",
                (employee_id,),
            )
        else:
            cursor.execute("SELECT * FROM leave_requests ORDER BY created_at DESC")
        return cursor.fetchall()


def delete_leave_request(leave_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM leave_requests WHERE id = ?", (leave_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted


def add_audit_log(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO audit_logs (
                actor_username, action, module_name, entity_key, payload, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("actor_username"),
                data["action"],
                data["module_name"],
                data.get("entity_key"),
                data.get("payload"),
                data.get("ip_address"),
            ),
        )
        log_id = cursor.lastrowid
        conn.commit()
        return log_id


def get_audit_logs(module_name=None, limit=100):
    with get_connection() as conn:
        cursor = conn.cursor()
        safe_limit = max(1, min(int(limit), 1000))
        if module_name:
            cursor.execute(
                f"""
                SELECT * FROM audit_logs
                WHERE module_name = ?
                ORDER BY created_at DESC
                LIMIT {safe_limit}
                """,
                (module_name,),
            )
        else:
            cursor.execute(
                f"""
                SELECT * FROM audit_logs
                ORDER BY created_at DESC
                LIMIT {safe_limit}
                """
            )
        return cursor.fetchall()


def get_hospital_dashboard_summary(selected_date=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # Default behavior (current date semantics)
        selected_date_clause = "DATE(arrival_at) = CURRENT_DATE"
        encounter_date_clause = "to_char(arrival_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        selected_date_params = ()
        target_month_val = None
        date_str = None
        
        # If a date is provided, validate it in Python to prevent executing a failing query
        # that would abort the PostgreSQL transaction state.
        if selected_date:
            try:
                parsed_dt = None
                for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
                    try:
                        parsed_dt = datetime.strptime(selected_date, fmt)
                        break
                    except ValueError:
                        continue
                if parsed_dt:
                    date_str = parsed_dt.date().isoformat()
                    target_month_val = parsed_dt.strftime("%Y-%m")
                    selected_date_clause = "DATE(arrival_at) = DATE(?)"
                    selected_date_params = (date_str,)
                    encounter_date_clause = "to_char(arrival_at, 'YYYY-MM') = ?"
            except Exception:
                pass

        # 1. Encounters Daily & Monthly counts
        encounter_query_params = selected_date_params * 3
        if target_month_val:
            encounter_query_params = encounter_query_params + (target_month_val,)
            
        cursor.execute(
            f"""
            SELECT
                SUM(CASE WHEN encounter_type='IP' AND {selected_date_clause} THEN 1 ELSE 0 END) AS daily_ip,
                SUM(CASE WHEN encounter_type='OP' AND {selected_date_clause} THEN 1 ELSE 0 END) AS daily_op,
                SUM(CASE WHEN encounter_type='IP' THEN 1 ELSE 0 END) AS monthly_ip,
                SUM(CASE WHEN encounter_type='OP' THEN 1 ELSE 0 END) AS monthly_op,
                SUM(CASE WHEN is_accident=1 AND {selected_date_clause} THEN 1 ELSE 0 END) AS daily_accident,
                SUM(CASE WHEN is_accident=1 THEN 1 ELSE 0 END) AS monthly_accident
            FROM encounters
            WHERE {encounter_date_clause}
            """,
            encounter_query_params,
        )
        encounter_summary = dict(cursor.fetchone() or {})

        # 2. Revenue Summary
        selected_payment_date_clause = "DATE(created_at)=CURRENT_DATE"
        selected_invoice_date_clause = "DATE(i.created_at)=CURRENT_DATE"
        selected_diagnostic_date_clause = "DATE(created_at)=CURRENT_DATE"
        selected_pharmacy_date_clause = "DATE(sold_at)=CURRENT_DATE"
        
        payment_month_clause = "to_char(created_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        invoice_month_clause = "to_char(i.created_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        diagnostic_month_clause = "to_char(created_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        pharmacy_month_clause = "to_char(sold_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        
        revenue_query_params = ()
        
        if date_str:
            selected_payment_date_clause = "DATE(created_at)=DATE(?)"
            selected_invoice_date_clause = "DATE(i.created_at)=DATE(?)"
            selected_diagnostic_date_clause = "DATE(created_at)=DATE(?)"
            selected_pharmacy_date_clause = "DATE(sold_at)=DATE(?)"
            
            if target_month_val:
                payment_month_clause = "to_char(created_at, 'YYYY-MM') = ?"
                invoice_month_clause = "to_char(i.created_at, 'YYYY-MM') = ?"
                diagnostic_month_clause = "to_char(created_at, 'YYYY-MM') = ?"
                pharmacy_month_clause = "to_char(sold_at, 'YYYY-MM') = ?"
                revenue_query_params = (date_str, target_month_val) * 4

        cursor.execute(
            f"""
            SELECT
                COALESCE(SUM(today_value), 0) AS today_revenue,
                COALESCE(SUM(month_value), 0) AS monthly_revenue,
                COALESCE(SUM(due_value), 0) AS due_collection
            FROM (
                SELECT
                    CASE WHEN {selected_payment_date_clause} THEN amount ELSE 0 END AS today_value,
                    amount AS month_value,
                    0 AS due_value
                FROM invoice_payments
                WHERE {payment_month_clause}
                UNION ALL
                SELECT
                    CASE WHEN {selected_invoice_date_clause}
                         THEN CASE
                             WHEN (i.paid_amount - COALESCE(p.paid_total, 0)) + i.advance_amount - i.refunded_amount > 0
                             THEN (i.paid_amount - COALESCE(p.paid_total, 0)) + i.advance_amount - i.refunded_amount
                             ELSE 0
                         END
                         ELSE 0
                    END AS today_value,
                    CASE
                        WHEN (i.paid_amount - COALESCE(p.paid_total, 0)) + i.advance_amount - i.refunded_amount > 0
                        THEN (i.paid_amount - COALESCE(p.paid_total, 0)) + i.advance_amount - i.refunded_amount
                        ELSE 0
                    END AS month_value,
                    i.due_amount AS due_value
                FROM invoices i
                LEFT JOIN (
                    SELECT invoice_id, COALESCE(SUM(amount), 0) AS paid_total
                    FROM invoice_payments
                    GROUP BY invoice_id
                ) p ON p.invoice_id = i.id
                WHERE {invoice_month_clause}
                UNION ALL
                SELECT
                    CASE WHEN {selected_diagnostic_date_clause} THEN paid_amount ELSE 0 END AS today_value,
                    paid_amount AS month_value,
                    due_amount AS due_value
                FROM diagnostics
                WHERE {diagnostic_month_clause}
                UNION ALL
                SELECT
                    CASE WHEN {selected_pharmacy_date_clause} THEN amount ELSE 0 END AS today_value,
                    amount AS month_value,
                    0 AS due_value
                FROM pharmacy_sales
                WHERE {pharmacy_month_clause}
            ) q
            """,
            revenue_query_params,
        )
        revenue_summary = dict(cursor.fetchone() or {})

        # 3. Period Revenue Summary
        if date_str:
            period_revenue_query = """
                SELECT
                    COALESCE(SUM(CASE WHEN DATE(created_at)=DATE(?) THEN amount ELSE 0 END), 0) AS today_revenue,
                    COALESCE(SUM(CASE WHEN DATE(created_at)>=DATE(?) - INTERVAL '6 days' AND DATE(created_at)<=DATE(?) THEN amount ELSE 0 END), 0) AS weekly_revenue,
                    COALESCE(SUM(CASE WHEN DATE(created_at)>=DATE_TRUNC('month', DATE(?)) AND DATE(created_at)<=DATE(?) THEN amount ELSE 0 END), 0) AS monthly_revenue,
                    COALESCE(SUM(CASE WHEN DATE(created_at)>=DATE_TRUNC('year', DATE(?)) AND DATE(created_at)<=DATE(?) THEN amount ELSE 0 END), 0) AS yearly_revenue
                FROM (
                    SELECT created_at, amount
                    FROM invoice_payments
                    UNION ALL
                    SELECT created_at, paid_amount AS amount
                    FROM diagnostics
                    UNION ALL
                    SELECT sold_at AS created_at, amount
                    FROM pharmacy_sales
                ) q
            """
            period_revenue_params = (date_str, date_str, date_str, date_str, date_str, date_str, date_str)
        else:
            period_revenue_query = """
                SELECT
                    COALESCE(SUM(CASE WHEN DATE(created_at)=CURRENT_DATE THEN amount ELSE 0 END), 0) AS today_revenue,
                    COALESCE(SUM(CASE WHEN DATE(created_at)>=CURRENT_DATE - INTERVAL '6 days' THEN amount ELSE 0 END), 0) AS weekly_revenue,
                    COALESCE(SUM(CASE WHEN DATE(created_at)>=DATE_TRUNC('month', CURRENT_DATE) THEN amount ELSE 0 END), 0) AS monthly_revenue,
                    COALESCE(SUM(CASE WHEN DATE(created_at)>=DATE_TRUNC('year', CURRENT_DATE) THEN amount ELSE 0 END), 0) AS yearly_revenue
                FROM (
                    SELECT created_at, amount
                    FROM invoice_payments
                    UNION ALL
                    SELECT created_at, paid_amount AS amount
                    FROM diagnostics
                    UNION ALL
                    SELECT sold_at AS created_at, amount
                    FROM pharmacy_sales
                ) q
            """
            period_revenue_params = ()

        cursor.execute(period_revenue_query, period_revenue_params)
        period_revenue_summary = dict(cursor.fetchone() or {})

        # 4. Payment Mode Breakdown
        selected_payment_mode_clause = "DATE(created_at)=CURRENT_DATE"
        selected_diagnostic_mode_clause = "DATE(created_at)=CURRENT_DATE"
        selected_pharmacy_mode_clause = "DATE(sold_at)=CURRENT_DATE"
        selected_invoice_mode_clause = "DATE(i.created_at)=CURRENT_DATE"
        
        mode_breakdown_params = ()
        if date_str:
            selected_payment_mode_clause = "DATE(created_at)=DATE(?)"
            selected_diagnostic_mode_clause = "DATE(created_at)=DATE(?)"
            selected_pharmacy_mode_clause = "DATE(sold_at)=DATE(?)"
            selected_invoice_mode_clause = "DATE(i.created_at)=DATE(?)"
            mode_breakdown_params = (date_str,) * 4

        cursor.execute(
            f"""
            SELECT label, COALESCE(SUM(count), 0) AS count
            FROM (
                SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'cash') AS label,
                       COALESCE(SUM(amount), 0) AS count
                FROM invoice_payments
                WHERE {selected_payment_mode_clause}
                GROUP BY label
                UNION ALL
                SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'cash') AS label,
                       COALESCE(SUM(paid_amount), 0) AS count
                FROM diagnostics
                WHERE {selected_diagnostic_mode_clause}
                GROUP BY label
                UNION ALL
                SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'cash') AS label,
                       COALESCE(SUM(amount), 0) AS count
                FROM pharmacy_sales
                WHERE {selected_pharmacy_mode_clause}
                GROUP BY label
                UNION ALL
                SELECT 'cash' AS label,
                       COALESCE(SUM(
                           CASE
                               WHEN i.paid_amount - COALESCE(p.paid_total, 0) > 0
                               THEN i.paid_amount - COALESCE(p.paid_total, 0)
                               ELSE 0
                           END
                       ), 0) AS count
                FROM invoices i
                LEFT JOIN (
                    SELECT invoice_id, COALESCE(SUM(amount), 0) AS paid_total
                    FROM invoice_payments
                    GROUP BY invoice_id
                ) p ON p.invoice_id = i.id
                WHERE {selected_invoice_mode_clause}
            ) q
            GROUP BY label
            ORDER BY count DESC
            """,
            mode_breakdown_params,
        )
        payment_mode_breakdown = normalize_payment_mode_breakdown([dict(row) for row in cursor.fetchall()])

        # 5. Income by Module and Referrals
        diagnostics_income_month_clause = "to_char(created_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        pharmacy_sales_month_clause = "to_char(sold_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        revenue_module_month_clause_ip = "to_char(ip.created_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        revenue_module_month_clause_i = "to_char(i.created_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        revenue_module_month_clause_diag = "to_char(created_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        revenue_module_month_clause_pharm = "to_char(sold_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        referral_month_clause = "to_char(arrival_at, 'YYYY-MM')=to_char(CURRENT_DATE, 'YYYY-MM')"
        
        diag_income_params = ()
        pharm_sales_params = ()
        module_breakdown_params = ()
        referrals_params = ()
        
        if target_month_val:
            diagnostics_income_month_clause = "to_char(created_at, 'YYYY-MM') = ?"
            diag_income_params = (target_month_val,)
            
            pharmacy_sales_month_clause = "to_char(sold_at, 'YYYY-MM') = ?"
            pharm_sales_params = (target_month_val,)
            
            revenue_module_month_clause_ip = "to_char(ip.created_at, 'YYYY-MM') = ?"
            revenue_module_month_clause_i = "to_char(i.created_at, 'YYYY-MM') = ?"
            revenue_module_month_clause_diag = "to_char(created_at, 'YYYY-MM') = ?"
            revenue_module_month_clause_pharm = "to_char(sold_at, 'YYYY-MM') = ?"
            
            op_billing_today_clause_ip = "DATE(ip.created_at)=DATE(?)" if date_str else "DATE(ip.created_at)=CURRENT_DATE"
            op_billing_today_clause_i = "DATE(i.created_at)=DATE(?)" if date_str else "DATE(i.created_at)=CURRENT_DATE"
            lab_today_clause = "DATE(created_at)=DATE(?)" if date_str else "DATE(created_at)=CURRENT_DATE"
            pharmacy_today_clause = "DATE(sold_at)=DATE(?)" if date_str else "DATE(sold_at)=CURRENT_DATE"
            
            # Setup module breakdown query parameters
            # Subquery 1: today_clause (date_str), month_clause (target_month_val)
            # Subquery 2: today_clause (date_str), month_clause (target_month_val)
            # Subquery 3: today_clause (date_str), month_clause (target_month_val)
            # Subquery 4: today_clause (date_str), month_clause (target_month_val)
            module_breakdown_params = (
                (date_str, target_month_val) +
                (date_str, target_month_val) +
                (date_str, target_month_val) +
                (date_str, target_month_val)
            )
            
            referral_month_clause = "to_char(arrival_at, 'YYYY-MM') = ?"
            referrals_params = (target_month_val,)
        else:
            op_billing_today_clause_ip = "DATE(ip.created_at)=CURRENT_DATE"
            op_billing_today_clause_i = "DATE(i.created_at)=CURRENT_DATE"
            lab_today_clause = "DATE(created_at)=CURRENT_DATE"
            pharmacy_today_clause = "DATE(sold_at)=CURRENT_DATE"

        cursor.execute(
            f"""
            SELECT COALESCE(SUM(amount), 0) AS diagnostics_income
            FROM diagnostics
            WHERE {diagnostics_income_month_clause}
            """,
            diag_income_params
        )
        diagnostics_income_row = cursor.fetchone()
        diagnostics_income = diagnostics_income_row["diagnostics_income"] if diagnostics_income_row else 0

        cursor.execute(
            f"""
            SELECT COALESCE(SUM(amount), 0) AS pharmacy_sales
            FROM pharmacy_sales
            WHERE {pharmacy_sales_month_clause}
            """,
            pharm_sales_params
        )
        pharmacy_sales_row = cursor.fetchone()
        pharmacy_sales = pharmacy_sales_row["pharmacy_sales"] if pharmacy_sales_row else 0

        cursor.execute(
            f"""
            SELECT label,
                   COALESCE(SUM(today_value), 0) AS today_amount,
                   COALESCE(SUM(month_amount), 0) AS month_amount
            FROM (
                SELECT
                    'op_billing' AS label,
                    CASE WHEN {op_billing_today_clause_ip} THEN ip.amount ELSE 0 END AS today_value,
                    ip.amount AS month_amount
                FROM invoice_payments ip
                INNER JOIN invoices i ON i.id = ip.invoice_id
                WHERE i.module = 'OP'
                  AND {revenue_module_month_clause_ip}
                UNION ALL
                SELECT
                    'op_billing' AS label,
                    CASE WHEN {op_billing_today_clause_i}
                         THEN CASE
                             WHEN (i.paid_amount - COALESCE(p.paid_total, 0)) + i.advance_amount - i.refunded_amount > 0
                             THEN (i.paid_amount - COALESCE(p.paid_total, 0)) + i.advance_amount - i.refunded_amount
                             ELSE 0
                         END
                         ELSE 0
                    END AS today_value,
                    CASE
                        WHEN (i.paid_amount - COALESCE(p.paid_total, 0)) + i.advance_amount - i.refunded_amount > 0
                        THEN (i.paid_amount - COALESCE(p.paid_total, 0)) + i.advance_amount - i.refunded_amount
                        ELSE 0
                    END AS month_amount
                FROM invoices i
                LEFT JOIN (
                    SELECT invoice_id, COALESCE(SUM(amount), 0) AS paid_total
                    FROM invoice_payments
                    GROUP BY invoice_id
                ) p ON p.invoice_id = i.id
                WHERE i.module = 'OP'
                  AND {revenue_module_month_clause_i}
                UNION ALL
                SELECT
                    'lab_diagnostics' AS label,
                    CASE WHEN {lab_today_clause} THEN paid_amount ELSE 0 END AS today_value,
                    paid_amount AS month_amount
                FROM diagnostics
                WHERE {revenue_module_month_clause_diag}
                UNION ALL
                SELECT
                    'pharmacy' AS label,
                    CASE WHEN {pharmacy_today_clause} THEN amount ELSE 0 END AS today_value,
                    amount AS month_amount
                FROM pharmacy_sales
                WHERE {revenue_module_month_clause_pharm}
            ) q
            GROUP BY label
            """,
            module_breakdown_params
        )
        revenue_module_rows = [dict(row) for row in cursor.fetchall()]
        revenue_module_breakdown = {
            "today": {"op_billing": 0, "lab_diagnostics": 0, "pharmacy": 0},
            "monthly": {"op_billing": 0, "lab_diagnostics": 0, "pharmacy": 0},
        }
        for module_row in revenue_module_rows:
            label = module_row.get("label")
            if label in revenue_module_breakdown["today"]:
                revenue_module_breakdown["today"][label] = module_row.get("today_amount", 0) or 0
                revenue_module_breakdown["monthly"][label] = module_row.get("month_amount", 0) or 0

        cursor.execute(
            f"""
            SELECT COALESCE(referral_source, 'unknown') AS label, COUNT(*) AS count
            FROM encounters
            WHERE {referral_month_clause}
            GROUP BY referral_source
            ORDER BY count DESC
            """,
            referrals_params
        )
        referral_summary = [dict(row) for row in cursor.fetchall()]

        # Helper to run scalar SQL queries with optional parameters
        def scalar(query, params=()):
            cursor.execute(query, params)
            row = cursor.fetchone()
            if not row:
                return 0
            value = row[0]
            return value or 0

        # Define date placeholders for operations_today queries
        if date_str:
            date_placeholder = "DATE(?)"
            scalar_date_params = (date_str,)
        else:
            date_placeholder = "CURRENT_DATE"
            scalar_date_params = ()

        patient_registration_total = scalar(
            f"SELECT COUNT(*) FROM patients WHERE DATE(created_at)={date_placeholder}",
            scalar_date_params
        )
        queue_total = scalar(
            f"SELECT COUNT(*) FROM appointments WHERE DATE(COALESCE(appointment_date, created_at))={date_placeholder}",
            scalar_date_params
        )
        queue_completed = scalar(
            f"""
            SELECT COUNT(*) FROM appointments
            WHERE DATE(COALESCE(appointment_date, created_at))={date_placeholder}
              AND LOWER(COALESCE(status, '')) IN ('completed', 'finished', 'consulted', 'done')
            """,
            scalar_date_params
        )
        queue_pending = max(queue_total - queue_completed, 0)

        billing_total = scalar(
            f"SELECT COUNT(*) FROM invoices WHERE DATE(created_at)={date_placeholder}",
            scalar_date_params
        )
        billing_completed = scalar(
            f"""
            SELECT COUNT(*) FROM invoices
            WHERE DATE(created_at)={date_placeholder}
              AND (LOWER(COALESCE(payment_status, ''))='paid' OR COALESCE(paid_amount, 0) > 0)
            """,
            scalar_date_params
        )
        billing_pending = scalar(
            f"""
            SELECT COUNT(*) FROM invoices
            WHERE DATE(created_at)={date_placeholder}
              AND (COALESCE(due_amount, 0) > 0 OR LOWER(COALESCE(payment_status, '')) IN ('due', 'partial', 'pending'))
            """,
            scalar_date_params
        )

        payment_collection_completed = scalar(
            f"""
            SELECT COALESCE(SUM(total_count), 0)
            FROM (
                SELECT COUNT(*) AS total_count FROM invoice_payments WHERE DATE(created_at)={date_placeholder}
                UNION ALL
                SELECT COUNT(*) AS total_count FROM diagnostics WHERE DATE(created_at)={date_placeholder} AND COALESCE(paid_amount, 0) > 0
                UNION ALL
                SELECT COUNT(*) AS total_count FROM pharmacy_sales WHERE DATE(sold_at)={date_placeholder}
            ) q
            """,
            scalar_date_params * 3
        )
        payment_collection_pending = scalar(
            f"""
            SELECT COALESCE(SUM(total_count), 0)
            FROM (
                SELECT COUNT(*) AS total_count FROM invoices WHERE DATE(created_at)={date_placeholder} AND COALESCE(due_amount, 0) > 0
                UNION ALL
                SELECT COUNT(*) AS total_count FROM diagnostics WHERE DATE(created_at)={date_placeholder} AND COALESCE(due_amount, 0) > 0
            ) q
            """,
            scalar_date_params * 2
        )
        payment_collection_total = payment_collection_completed + payment_collection_pending

        today_revenue_record_count = scalar(
            f"""
            SELECT COALESCE(SUM(total_count), 0)
            FROM (
                SELECT COUNT(*) AS total_count FROM invoice_payments WHERE DATE(created_at)={date_placeholder}
                UNION ALL
                SELECT COUNT(*) AS total_count FROM invoices WHERE DATE(created_at)={date_placeholder}
                UNION ALL
                SELECT COUNT(*) AS total_count FROM diagnostics WHERE DATE(created_at)={date_placeholder}
                UNION ALL
                SELECT COUNT(*) AS total_count FROM pharmacy_sales WHERE DATE(sold_at)={date_placeholder}
            ) q
            """,
            scalar_date_params * 4
        )
        revenue_reporting_count = 1 if today_revenue_record_count > 0 else 0

        # Payout Summary Dates
        payout_total_query = "SELECT COUNT(*) FROM doctor_payouts WHERE DATE(created_at)=CURRENT_DATE OR payout_month=to_char(CURRENT_DATE, 'YYYY-MM')"
        payout_completed_query = """
            SELECT COUNT(*) FROM doctor_payouts
            WHERE (DATE(created_at)=CURRENT_DATE OR payout_month=to_char(CURRENT_DATE, 'YYYY-MM'))
              AND (LOWER(COALESCE(status, ''))='paid' OR COALESCE(due_amount, 0)=0)
        """
        payout_ready_query = """
            SELECT COALESCE(SUM(
                CASE
                    WHEN COALESCE(due_amount, 0) > 0 THEN due_amount
                    WHEN LOWER(COALESCE(status, '')) IN ('pending', 'partial') THEN GREATEST(COALESCE(amount, 0) - COALESCE(paid_amount, 0), 0)
                    ELSE 0
                END
            ), 0)
            FROM doctor_payouts
            WHERE to_char(CURRENT_DATE, 'YYYY-MM') IN (payout_month, to_char(created_at::date, 'YYYY-MM'))
        """
        payout_total_params = ()
        payout_completed_params = ()
        payout_ready_params = ()

        if date_str and target_month_val:
            payout_total_query = "SELECT COUNT(*) FROM doctor_payouts WHERE DATE(created_at)=DATE(?) OR payout_month=?"
            payout_total_params = (date_str, target_month_val)
            
            payout_completed_query = """
                SELECT COUNT(*) FROM doctor_payouts
                WHERE (DATE(created_at)=DATE(?) OR payout_month=?)
                  AND (LOWER(COALESCE(status, ''))='paid' OR COALESCE(due_amount, 0)=0)
            """
            payout_completed_params = (date_str, target_month_val)
            
            payout_ready_query = """
                SELECT COALESCE(SUM(
                    CASE
                        WHEN COALESCE(due_amount, 0) > 0 THEN due_amount
                        WHEN LOWER(COALESCE(status, '')) IN ('pending', 'partial') THEN GREATEST(COALESCE(amount, 0) - COALESCE(paid_amount, 0), 0)
                        ELSE 0
                    END
                ), 0)
                FROM doctor_payouts
                WHERE ? IN (payout_month, to_char(created_at::date, 'YYYY-MM'))
            """
            payout_ready_params = (target_month_val,)

        doctor_payout_total = scalar(payout_total_query, payout_total_params)
        doctor_payout_completed = scalar(payout_completed_query, payout_completed_params)
        doctor_payout_pending = max(doctor_payout_total - doctor_payout_completed, 0)
        doctor_payout_ready = scalar(payout_ready_query, payout_ready_params)

        operations_today = {
            "patient_registration": {"count": patient_registration_total, "completed": patient_registration_total, "pending": 0},
            "queue_management": {"count": queue_total, "completed": queue_completed, "pending": queue_pending},
            "doctor_consultation": {"count": queue_total, "completed": queue_completed, "pending": queue_pending},
            "billing": {"count": billing_total, "completed": billing_completed, "pending": billing_pending},
            "payment_collection": {"count": payment_collection_total, "completed": payment_collection_completed, "pending": payment_collection_pending},
            "revenue_reporting": {"count": revenue_reporting_count, "completed": revenue_reporting_count, "pending": 0},
            "doctor_payout": {"count": doctor_payout_total, "completed": doctor_payout_completed, "pending": doctor_payout_pending},
        }

    return {
        "ip_op_counts": {
            "daily_ip": encounter_summary.get("daily_ip", 0) or 0,
            "daily_op": encounter_summary.get("daily_op", 0) or 0,
            "monthly_ip": encounter_summary.get("monthly_ip", 0) or 0,
            "monthly_op": encounter_summary.get("monthly_op", 0) or 0,
        },
        "accidents": {
            "daily": encounter_summary.get("daily_accident", 0) or 0,
            "monthly": encounter_summary.get("monthly_accident", 0) or 0,
        },
        "revenue": {
            "total": revenue_summary.get("monthly_revenue", 0) or 0,
            "today_total": revenue_summary.get("today_revenue", 0) or 0,
            "weekly_revenue": period_revenue_summary.get("weekly_revenue", 0) or 0,
            "weekly_total": period_revenue_summary.get("weekly_revenue", 0) or 0,
            "monthly_total": revenue_summary.get("monthly_revenue", 0) or 0,
            "monthly_revenue": revenue_summary.get("monthly_revenue", 0) or 0,
            "yearly_revenue": period_revenue_summary.get("yearly_revenue", 0) or 0,
            "yearly_total": period_revenue_summary.get("yearly_revenue", 0) or 0,
            "due": revenue_summary.get("due_collection", 0) or 0,
            "today_collection": period_revenue_summary.get("today_revenue", 0) or 0,
            "total_collection": period_revenue_summary.get("monthly_revenue", 0) or 0,
            "pending_payments": revenue_summary.get("due_collection", 0) or 0,
            "paid_payments": period_revenue_summary.get("monthly_revenue", 0) or 0,
            "doctor_payout_ready": doctor_payout_ready,
            "payment_mode_breakdown": payment_mode_breakdown,
            "module_breakdown": revenue_module_breakdown,
        },
        "payment_summary": {
            "total_collection": period_revenue_summary.get("monthly_revenue", 0) or 0,
            "pending_payments": revenue_summary.get("due_collection", 0) or 0,
            "paid_payments": period_revenue_summary.get("monthly_revenue", 0) or 0,
            "today_collection": period_revenue_summary.get("today_revenue", 0) or 0,
        },
        "pharmacy_summary": {"monthly_sales": pharmacy_sales},
        "diagnostics_summary": {"monthly_income": diagnostics_income},
        "operations_today": operations_today,
        "referrals": referral_summary,
    }


def create_shared_export(share_token, file_path, file_name, mime_type):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO shared_exports (share_token, file_path, file_name, mime_type)
            VALUES (?, ?, ?, ?)
            """,
            (share_token, file_path, file_name, mime_type),
        )
        conn.commit()


def get_shared_export(share_token):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT * FROM shared_exports
            WHERE share_token = ?
            """,
            (share_token,),
        )
        return cursor.fetchone()
