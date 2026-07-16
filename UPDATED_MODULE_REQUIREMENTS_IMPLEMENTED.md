# Updated Module Requirements Implemented

Implemented from uploaded PDF and latest prompt:

- Overview Dashboard: removed OP queue waiting, AI insights, bed occupancy, queue snapshot, notification icon, alerts/notifications, pending lab reports, pending bills.
- Overview Dashboard: added Today Revenue, Monthly Revenue, Lab Revenue, Pharmacy Revenue using live backend data, not dummy/default values.
- Dashboard PDF export updated to match the cleaned revenue-focused dashboard.
- OP Management: Patient Search retained, Clinical Operations/alerts removed from active navigation.
- Patient Registration: Department Master removed.
- Queue Management: search/view action opens patient details; queue table now includes Doctor Name and Department.
- Queue Management: hard-coded filter defaults removed; filters are populated from live queue data.
- Doctor Scheduling: Schedule OP Visit form removed; doctor schedule remains.
- Follow-up/Re-admit renamed to Follow-up/Re-visit and Re-visit labels applied.
- OP Management: Pharmacy added as module 2.6 in navigation.
- Billing: Consultation Billing removed from navigation; Lab & Diagnostic Billing added.
- Backend hospital summary now returns today_total and monthly_total revenue separately, plus live lab/pharmacy revenue sources.

Validation performed:
- Frontend production build completed with Vite.
- Backend Python syntax check completed for app.py and utils/database.py.
