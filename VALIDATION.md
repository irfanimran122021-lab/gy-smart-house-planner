# Validation record

Date: 23 October 2026 (America/Guyana)

## Automated

- Unit/geometry/export/server integration suite: 20 passing tests.
- Database migration suite: 16 passing tests on real local PostgreSQL 18.4, with isolated Supabase auth/storage schema fixtures. Includes actual concurrent connections (80 calls -> 20 accepts; 40 calls at 19 used -> one accept), RLS/ACL isolation, foreign-key integrity, storage restrictive policies, UTC windows, search-path protection and transactional failure/rollback tests. No live Supabase database accessed.
- Combined suite: all 36 tests passed with no failures or skips. The test harness uses native `pg_ctl` shutdown and verified temporary-directory cleanup, avoiding global exit hooks in the test worker.
- Strict TypeScript validation: passed.
- Next.js production build: passed, including `/`, `/api/interpret` and `/api/assistant`.
- Further checks are recorded in the task completion report and Git history.

## Browser checks

- Application loaded and displayed the real vector floor plan and project inspector.
- Eight-apartment example displayed the unallocated 1 ft setback discrepancy and the constrained-layout fit failure.
- Corrected setbacks (5.5 ft each) and total apartments (4) generated two selectable layouts.
- Applied a layout and verified the live drawing updated.
- Downloaded a real 12-sheet vector PDF through the browser export dialog.
- Inspected the desktop drawing workspace at 1440 × 1000; layout remained within the viewport width.
- Verified browser DXF download produced an actual CAD file.
- Checked mobile dashboard/editor at 390 × 844 and tablet editor at 768 × 1024: document width stayed within the viewport.
- Inspected rendered PDF floor, site and elevation pages; corrected a title-block fill that hid text, then verified the regenerated pages.
- Renamed a project, saved it, reloaded the page and verified the changed project reopened.
- Created a second project and confirmed both projects remained in the dashboard.

## Not verified against live services

No Supabase or OpenAI credentials were used. The migration's RLS policies, grants, constraints and quota function were executed and tested locally against PostgreSQL with managed-schema fixtures. Live sign-in/JWT verification, Storage API uploads and signed URLs, extraction accuracy, assistant model output and cross-device persistence still require the credential-backed launch checks listed in README.md. No government compliance, engineering certification or Vercel deployment is established by this record.
