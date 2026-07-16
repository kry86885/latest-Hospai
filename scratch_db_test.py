import sys
import os

# Add backend directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))

from utils.database import create_diagnostic_record, get_connection

payload = {
    "invoice_no": "LAB-20260715-0001-0",
    "patient_id": "PAT-20260715-0001",
    "patient_name": "Test Patient",
    "age": 30,
    "gender": "Male",
    "test_name": "Lab - Test Test",
    "amount": 6000.0,
    "payable_amount": 5940.0,
    "paid_amount": 776.0,
    "discount_percentage": 1.0,
    "discount_amount": 60.0,
    "tax_percentage": 0.0,
    "tax_amount": 0.0,
    "payment_mode": "Cash",
    "bill_date": "",
    "due_date": "",
    "report_delivery_date": ""
}

try:
    print("Testing create_diagnostic_record...")
    diag_id = create_diagnostic_record(payload)
    print(f"Success! Created record ID: {diag_id}")
    
    # Let's verify if invoice was created
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM invoices WHERE invoice_no = %s", (payload["invoice_no"],))
        inv = cursor.fetchone()
        print(f"Invoice details in DB: {dict(inv) if inv else 'NOT FOUND'}")
        
        # Cleanup
        cursor.execute("DELETE FROM diagnostics WHERE id = %s", (diag_id,))
        cursor.execute("DELETE FROM invoices WHERE invoice_no = %s", (payload["invoice_no"],))
        conn.commit()
    print("Cleaned up successfully.")
except Exception as e:
    import traceback
    traceback.print_exc()
