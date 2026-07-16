import os, re
from dotenv import load_dotenv
import psycopg2

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
load_dotenv(os.path.join(BASE, '.env'), override=False)
DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    raise SystemExit('DATABASE_URL not found')

with open(os.path.join(BASE, 'utils', 'database.py'), 'r', encoding='utf-8') as f:
    src = f.read()

# Extract only CREATE TABLE IF NOT EXISTS ... ) blocks to avoid non-DDL SQL
pattern = re.compile(r"CREATE TABLE IF NOT EXISTS[\s\S]*?\)\s*\n\s*\"\"\"", re.I)
matches = pattern.findall(src)
create_stmts = []
for m in matches:
    # Remove any trailing triple-quote leftover
    sql = m.rstrip()
    # Ensure id_column placeholder is replaced
    sql = sql.replace('{id_column}', 'SERIAL PRIMARY KEY')
    create_stmts.append(sql)

if not create_stmts:
    print('No CREATE TABLE statements found')
    raise SystemExit(0)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

for sql in create_stmts:
    try:
        print('Running CREATE TABLE block (preview):', sql.split('\n',1)[0])
        cur.execute(sql)
        conn.commit()
    except Exception as e:
        print('Error running SQL block:', e)
        conn.rollback()

cur.close()
conn.close()
print('Done')
