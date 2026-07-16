# Re-admit OP Queue Update

## Fixed
1. Removed the document upload section from the expanded Re-admit Patient form:
   - Test Documents
   - X-Ray / MRI
   - Prescription
   - OCR result panels from the re-admit workflow

2. Updated the re-admit confirmation flow:
   - After clicking **Confirm Re-admission**, the patient is now added directly to OP Queue Management.
   - The OP queue entry uses visit type **Readmission**.
   - Token format for re-admitted patients is `RA-xxxxxx`.

3. Updated OP Queue Management:
   - Reads re-admitted patients from local queue storage first.
   - Shows re-admitted patients at the top of the queue.
   - Keeps regular patient queue entries below them.
   - Avoids duplicate queue rows for the same patient when the patient is already added through readmission.
   - Queue action updates/removal now preserve the re-admitted queue state.

## Files changed
- frontend/src/pages/ReadmitPage.tsx
- frontend/src/pages/OpQueuePage.tsx
