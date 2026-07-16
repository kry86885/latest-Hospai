import os
from dotenv import load_dotenv
import psycopg2

BACKEND_DIR = os.path.abspath(os.path.dirname(__file__) + "/..")
load_dotenv(os.path.join(BACKEND_DIR, ".env"), override=False)
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise SystemExit("DATABASE_URL not found in backend/.env")

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()
cur.execute(
    """
    CREATE TABLE IF NOT EXISTS bed_config (
        hospital_id INTEGER PRIMARY KEY,
        capacity INTEGER DEFAULT 50
    )
    """
)
cur.execute(
    """
    INSERT INTO bed_config (hospital_id, capacity)
    VALUES (%s, %s)
    ON CONFLICT (hospital_id) DO NOTHING
    """,
    (1, 50),
)
conn.commit()
cur.close()
conn.close()
print("bed_config ensured")
