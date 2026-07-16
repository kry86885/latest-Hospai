import os
from dotenv import load_dotenv
import psycopg2

BACKEND_DIR = os.path.abspath(os.path.dirname(__file__) + "/..")
load_dotenv(os.path.join(BACKEND_DIR, ".env"), override=False)
DATABASE_URL = os.getenv("DATABASE_URL")
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()
for name in ["encounters","bed_allocations","bed_config","patients","users"]:
    cur.execute("SELECT to_regclass(%s)", (name,))
    print(name, cur.fetchone()[0])
cur.close()
conn.close()
