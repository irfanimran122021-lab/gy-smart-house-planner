# Validation record

## Authentication diagnosis and recovery — 17 November 2026

- Production's public Supabase URL resolves to project `zzqadafqlkavpryskwut`;
  the public anon key reference matches. Read-only public Auth settings confirm
  email authentication/signups enabled and email confirmation required. No keys
  were printed or committed. The intended dashboard project remains an operator
  comparison; private redirect settings and the existing user's password were
  not inspected or changed.
- Invalid-credentials guidance now points to the existing account's password
  recovery. Unconfirmed-email errors point to resend confirmation. Passwords
  continue to be passed unchanged; user UUIDs, projects and policies are preserved.
- Recovery/confirmation intent is captured before SDK token-fragment cleanup.
  Dashboard recovery links without the app query are supported. Expired links
  never open the password form using an older session. Callback fragments are
  cleaned and valid recovery can survive a refresh using a non-secret marker.
- All 63 tests pass locally, including nine new callback, diagnostic and real-SDK
  flow tests. SDK tests use isolated HTTP responses and test identities; they send
  no real email and do not replace the user's live password-reset acceptance.
- Strict TypeScript and Next.js production build pass. No dependency changes or
  SQL migration is needed. Exact dashboard checks are in `AUTH_SETUP.md`.

## PostgreSQL lifecycle fix — 24 October 2026

The database test teardown now waits for every pooled client's `end` event after
`pool.end()`. pg-pool can finish its bookkeeping before client sockets close;
stopping PostgreSQL in that gap caused Linux to report administrator-termination
errors after otherwise successful tests. Standalone fixture clients and the
PostgreSQL child process also have explicit close barriers. Concurrent quota
batches await all sibling operations even when one rejects. Unexpected driver
errors are collected and rethrown from teardown, never suppressed.

The local suite passes all 54 tests, including two deterministic lifecycle
regressions for delayed socket closure and propagation of connection errors.
The original 80-connection/40-connection quota tests and all security tests remain.
No application code, production database migration or security policy is changed.
Remote Linux CI and deployment results are reported in the task completion message.

## Authentication/cloud update — 24 October 2026 (America/Guyana)

- 52 automated tests pass: 20 existing application tests, 20 real PostgreSQL
  database/security tests, 11 authentication/cloud/cache tests, and one real
  Supabase SDK session-persistence test with isolated HTTP/storage responses.
- Both migration files execute in a fresh disposable PostgreSQL cluster. Atomic
  save tests cover create/reopen through separate connections, 12 concurrent edits
  of one version (exactly one wins), stale/new-ID collisions, ownership isolation,
  and rollback of the project when a revision write fails.
- Existing private bucket policies and concurrent AI quota tests continue passing.
- Strict TypeScript check and production build pass without cloud credentials.
  An initial sandbox filesystem restriction prevented one generated Next.js folder;
  repeating the build with the required filesystem access succeeded.
- Live deployed UI inspection confirmed the original studio label was not a button
  and no header Sign in/Create account buttons existed.
- Local production browser checks verify both header buttons, a functional studio
  dropdown, signup/signin/recovery forms, a clear missing-configuration error,
  existing floor-plan rendering, and preservation of two previous device projects.
  The document remains within its 1265 px viewport width.
- No production credentials, accounts or email sends were used. Live confirmation
  email delivery, recovery links, Supabase JWT gateway/Storage HTTP behavior and
  real cross-device acceptance remain operator checks in `AUTH_SETUP.md`.
- No live Supabase migration was run and no Vercel/GitHub project was created.

The record below describes the earlier baseline validation.

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
