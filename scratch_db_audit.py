import sys
import os

# Add backend directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))

from utils.database import get_connection

with get_connection() as conn:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;")
    logs = cursor.fetchall()
    print("Recent Audit Logs:")
    for row in logs:
        print(dict(row))
