import sys
import os

# Add backend directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))

from utils.database import get_connection

with get_connection() as conn:
    cursor = conn.cursor()
    for table_name in ['invoices', 'diagnostics']:
        cursor.execute("""
            SELECT
                conname,
                pg_get_constraintdef(c.oid)
            FROM
                pg_constraint c
            JOIN
                pg_namespace n ON n.oid = c.connamespace
            WHERE
                conrelid = ?::regclass;
        """, (table_name,))
        constraints = cursor.fetchall()
        print(f"Constraints for table '{table_name}':")
        for row in constraints:
            print(f" - {row[0]}: {row[1]}")
