# OP Queue Age / Gender Fix

## Fixed
- OP Queue Management now receives patient age, gender, and mobile from registered patient records.
- Queue table Age / Gender column now shows actual values instead of `- / -`.
- Patient Details panel now shows the same registered Age / Gender.
- Print Queue Slip also uses the live Age / Gender value.

## Technical Change
- `/api/appointments` now LEFT JOINs `appointments` with `patients` using `patient_id` / UHID.
- `OpQueuePage.tsx` maps `age` and `gender` into the display format `Age / Gender`.

## Verification
- Backend syntax check passed.
- Frontend production build passed with `PUPPETEER_SKIP_DOWNLOAD=1 npm run build`.
