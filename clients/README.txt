Kalpra internal client license registry
======================================

Generate mandatory 9-character activation code:
python license_tools\generate_license.py --device-id "HOSPAI-XXXX-XXXX-XXXX" --hospital "Hospital Name" --expiry "2026-06-25 05:30 PM"

The output must show Code Length: 9.

The registry CSV stores:
- generated_at
- hospital
- device_id
- expiry
- activation_code

Do not share clients_registry.csv with customers.
