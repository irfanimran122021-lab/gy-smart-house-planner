# Launch check — 17 November 2026, America/Guyana

Target: existing GY Smart House Planner deployment, by 18 November 2026.
Scope: test and repair existing functionality; no redesign or new project.

## Supabase project verification — passed

The deployed production build uses
`https://zzqadafqlkavpryskwut.supabase.co`. Its public anon key's project reference
is exactly `zzqadafqlkavpryskwut`, matching the owner-confirmed project ID. The
public Auth settings endpoint accepted the key: email sign-in and signups are
enabled and email confirmation is required. No keys were printed or committed.
No project/environment configuration was changed.

This verifies the actual configuration consumed by the deployed website. Private
Vercel dashboard entries, Supabase redirect allowlists, SMTP and live users were
not inspected through administrative credentials. The owner selected automated
and signed-out checks rather than providing a signed-in test session.

## Checks completed

| Area | Evidence | Result and boundary |
| --- | --- | --- |
| Authentication | Real SDK fixtures cover registration, confirmation callbacks, incorrect passwords, recovery, password update, persistent session and logout; live desktop/mobile forms open | Automated passed; real email delivery and owner login still need signed-in acceptance |
| Private project access | Live public-key requests to projects, project_revisions and ai_usage | All denied HTTP 401 / PostgreSQL 42501 while signed out |
| Cloud save/history | Disposable real PostgreSQL tests exercise owner RLS, atomic project+revision writes, second-connection reopening, stale save conflicts and concurrent writes; SDK fixture loads 101 projects and owner-filtered history | Passed in isolation; real second-device acceptance pending |
| Floor creation | Created separate device-only Launch QA drawing with default supported requirements and selected a generated option | Passed; pre-existing Providence residences retained |
| Room editing | Renamed living room to Living QA, set width to 17 ft, saved and refreshed | Exact edited values reopened |
| Measurements/walls/openings | Live measure returned 5 ft; drew a 5 ft wall right-to-left; resized a door and undid it; added a window, resized it to 3.5 ft and assigned connected spaces | Passed; direction-preserving wall-length repair has regression coverage |
| Device/native persistence | Reopened saved edits after reload; downloaded .gyplan and imported it | Imported as a separate new UUID; originals retained |
| References | Selected JPG, PNG, WEBP and PDF fixtures in live UI; attempted signed-out storage | All formats selected; upload correctly refused without sign-in |
| Storage security | Real database path/RLS tests; SDK fixtures exercise all four formats, no-overwrite uploads under verified owner and signed preview URLs | Passed in isolation; real authenticated upload/download pending |
| Exports | Downloaded actual PDF, DXF, SVG, PNG and .gyplan files through browser | Passed; PDF has 12 A1 pages, 841 x 594 mm; edited label extracted and floor/site pages visually inspected |
| Desktop/mobile | Desktop 1280 x 900 and mobile 390 x 844; editor, library and authentication forms | No document horizontal overflow; drawing canvas retains its own scrolling |
| Automated validation | Full test suite, strict TypeScript, production build | 67 tests passed locally; CI/deployment results reported with the completion message |

PDF render inspection used Poppler; the measured drawing stays at its physical
scale with title/stamp area and unfilled page space. Drawings remain preliminary
and require professional review; existing constrained-template limits still apply.

## Confirmed repairs in this update

- Wall length edits retain their original direction instead of reversing walls
  drawn right-to-left or bottom-to-top. Rejected geometry edits keep their error
  feedback rather than showing a misleading success notice.
- Reference file extensions must match the MIME type. Invalid file selection
  clears previously selected files, and upload validation also runs at the storage
  boundary before network upload. Existing bucket policies remain unchanged.
- Switching/importing a project clears stale selection, unfinished measurement
  clicks, reference evidence and unapplied proposals from the previous drawing.
  Project data and Undo/Redo implementations remain intact.

## Required owner checks before declaring launch-ready

1. **AI is currently unavailable in production.** Both API endpoints return HTTP
   503 with `AI is not configured. Set OPENAI_API_KEY and OPENAI_MODEL on the server.`
   In the existing Vercel project → Settings → Environment Variables, add/check
   server-only `OPENAI_API_KEY` and `OPENAI_MODEL` for Production. Use your own API
   key and an available model supporting the existing image/PDF structured-output
   integration. Do not use a NEXT_PUBLIC prefix or paste the key in chat/Git.
   Redeploy that same project, then test interpretation/assistant while signed in.
2. In Supabase → Authentication → URL Configuration, verify Site URL
   `https://gy-smart-house-planner.vercel.app` and Redirect URLs
   `https://gy-smart-house-planner.vercel.app/` and
   `https://gy-smart-house-planner.vercel.app/?auth=recovery`. Keep Email enabled
   and Confirm email ON. Confirm signup/reset templates should retain
   `{{ .ConfirmationURL }}`. Check SMTP/auth logs if mail is not delivered.
3. Confirm the existing cloud-save function is installed. This SQL Editor query
   is read-only:

   ```sql
   select to_regprocedure(
     'public.save_project(uuid,uuid,text,jsonb,timestamptz)'
   ) is not null as cloud_save_function_ready;
   ```

   If false, apply the entire additive `supabase/migrations/002_cloud_saving.sql`
   to the existing application database. Do not rerun `001` over existing tables,
   drop data or replace security policies. No live migration was run by the agent.
4. With an account you control, test confirmation, login, refresh, logout and
   password recovery. Create a QA cloud project; change a room; save; sign out;
   sign back in and reopen. Repeat on a second device. Preview a cloud revision
   before explicitly restoring it. Conflicting edits should offer a separate copy.
5. Upload a JPG/PNG/WEBP and PDF while signed in, open their private previews and
   confirm references remain attached after reopening the project.
6. Use a second test account to verify the first account's project UUIDs, revisions
   and private references are inaccessible. Do not delete existing user accounts
   or drawings to conduct these tests.

Code/automated checks passing is not proof that live email delivery, authenticated
cloud/storage and external AI are launch-ready. These remaining acceptance checks
must pass before announcing those services as fully operational.
