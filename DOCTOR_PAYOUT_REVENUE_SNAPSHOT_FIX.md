# Doctor Payout Revenue Snapshot Fix

Updated production build so Doctor Payout Ready is no longer hardcoded to zero.

## Fixed
- Dashboard Revenue Snapshot now reads Doctor Payout Ready from backend summary.
- Revenue Reports / Billing Revenue Snapshot now reads Doctor Payout Ready from selected summary.
- Date and month filtered revenue summary includes doctor payout ready using payout paid date / created date.
- Dashboard operations doctor payout row now reflects live payout counts and pending state.
- Clicking Doctor Payout Ready navigates to Accounts Doctor Payouts.

## Backend
- `/api/billing/revenue-summary` now returns `doctor_payout_ready`.
- `/api/hospital/summary` revenue block now returns `doctor_payout_ready`.

## Calculation
Doctor Payout Ready = pending due amount from `doctor_payouts`, using `due_amount` first and falling back to `amount - paid_amount` for pending/partial payouts.
