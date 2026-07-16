from datetime import datetime
from utils.database import get_report_patient_history

def _create_invoice(client, patient_id, total_amount=1200, module="OP"):
    response = client.post(
        "/api/billing/invoices",
        json={
            "patient_id": patient_id,
            "module": module,
            "doctor_name": "Dr. ReportHistory",
            "clinic_name": "General Clinic",
            "referral_source": "doctor",
            "total_amount": total_amount,
            "discount_amount": 100,
            "advance_amount": 150,
        },
    )
    assert response.status_code == 200
    return response.get_json()["invoice_id"]

def test_report_patient_history_by_module(auth_client, create_patient):
    # 1. Setup patient and record invoice payment
    patient_id = create_patient({"name": "Test", "last_name": "History"})
    invoice_id = _create_invoice(auth_client, patient_id, total_amount=2000, module="OP")
    
    pay_res = auth_client.post(
        f"/api/billing/invoices/{invoice_id}/payments",
        json={
            "amount": 1500,
            "payment_mode": "card",
            "gateway_ref": "ref-history-1",
        },
    )
    assert pay_res.status_code == 200

    # 2. Test direct database function for module
    db_res = get_report_patient_history(
        collection_date=datetime.now().strftime("%Y-%m-%d"),
        filter_type="module",
        filter_value="OP / Billing"
    )
    assert len(db_res) >= 1
    found = [r for r in db_res if r["patient_id"] == patient_id]
    assert len(found) == 1
    assert found[0]["patient_name"] == "Test History"
    assert found[0]["amount"] == 1500.0
    assert found[0]["payment_mode"] == "Card"

    # 3. Test HTTP GET endpoint for module
    response = auth_client.get(
        f"/api/reports/patient-history?type=module&value=OP%20%2F%20Billing&date={datetime.now().strftime('%Y-%m-%d')}"
    )
    assert response.status_code == 200
    endpoint_data = response.get_json()
    endpoint_found = [r for r in endpoint_data if r["patient_id"] == patient_id]
    assert len(endpoint_found) == 1
    assert endpoint_found[0]["patient_name"] == "Test History"
    assert endpoint_found[0]["amount"] == 1500.0
    assert endpoint_found[0]["payment_mode"] == "Card"

def test_report_patient_history_by_payment_mode(auth_client, create_patient):
    # 1. Setup patient and record invoice payment
    patient_id = create_patient({"name": "CardPay", "last_name": "Tester"})
    invoice_id = _create_invoice(auth_client, patient_id, total_amount=1500, module="OP")
    
    pay_res = auth_client.post(
        f"/api/billing/invoices/{invoice_id}/payments",
        json={
            "amount": 1200,
            "payment_mode": "upi",
            "gateway_ref": "ref-history-2",
        },
    )
    assert pay_res.status_code == 200

    # 2. Test direct database function for payment mode
    db_res = get_report_patient_history(
        collection_date=datetime.now().strftime("%Y-%m-%d"),
        filter_type="payment_mode",
        filter_value="upi"
    )
    assert len(db_res) >= 1
    found = [r for r in db_res if r["patient_id"] == patient_id]
    assert len(found) == 1
    assert found[0]["patient_name"] == "CardPay Tester"
    assert found[0]["amount"] == 1200.0
    assert found[0]["payment_mode"] == "Upi"

    # 3. Test HTTP GET endpoint for payment mode
    response = auth_client.get(
        f"/api/reports/patient-history?type=payment_mode&value=upi&date={datetime.now().strftime('%Y-%m-%d')}"
    )
    assert response.status_code == 200
    endpoint_data = response.get_json()
    endpoint_found = [r for r in endpoint_data if r["patient_id"] == patient_id]
    assert len(endpoint_found) == 1
    assert endpoint_found[0]["patient_name"] == "CardPay Tester"
    assert endpoint_found[0]["amount"] == 1200.0
    assert endpoint_found[0]["payment_mode"] == "Upi"
