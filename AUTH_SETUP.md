# Authentication and cloud saving

Use the existing GitHub repository, Supabase project and Vercel deployment at
https://gy-smart-house-planner.vercel.app. No replacement project is needed.

## Required operator configuration

1. In the existing Supabase project's Authentication settings, enable the Email
   provider and email/password signups. Keep email confirmation enabled for production.
2. Set **Site URL** to `https://gy-smart-house-planner.vercel.app` and allow these
   redirects: `https://gy-smart-house-planner.vercel.app/` and
   `https://gy-smart-house-planner.vercel.app/?auth=recovery`. Supabase also supports
   the domain-scoped `https://gy-smart-house-planner.vercel.app/**` allowlist for
   these callbacks. Add only development or preview origins you actually use.
3. Configure production email delivery (SMTP), sender identity, email templates and
   authentication rate limits in Supabase. Confirmation, password recovery and
   optional magic links depend on email delivery. The browser callback reads the
   Supabase session and opens the new-password form for recovery links.
4. If the existing application tables already exist, run the **entire**
   `supabase/migrations/002_cloud_saving.sql` in Supabase SQL Editor as `postgres`.
   It adds one function without removing projects, history, bucket policies or AI
   limits. For a completely empty application database, run `001_initial.sql`
   first, then `002_cloud_saving.sql`. Do not rerun `001` over existing tables.
5. Keep `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the
   existing Vercel project's Production environment and redeploy after changes.
   These are build-time browser settings. No service-role or secret Supabase key
   belongs in this application. AI continues using its existing server-only settings.

The migration has been tested in a disposable local PostgreSQL cluster. It has
**not** been applied to the live Supabase project by the development agent.

## Behavior and data preservation

- The header has Sign in and Create account controls. The existing My architecture
  studio button opens account options; signed-in users see their account, settings,
  cloud projects and Sign out. These controls also remain available on mobile.
- Authentication uses the Supabase browser SDK with persistent sessions and token
  refresh. Email/password signup, login, logout on this device, recovery, display
  name settings and the existing magic-link option are supported.
- Device projects remain on this device. Signing in never uploads them implicitly.
  Copy device projects to account requires selection and confirmation. It creates
  fresh project UUIDs and leaves the originals intact. Files owned by another
  account are not transferred with copied projects.
- The original `gy-planner-projects-v1` browser backup is never rewritten or deleted.
  Device edits use a separate v2 key. Account drafts use a separate key per user.
  Signing out clears account drawings from the UI without deleting cached drafts.
  Browser storage is device-local; use native exports as additional backups.
- Account project creation and edits save after a short pause; Save project also
  saves immediately. Open cloud projects from Overview or the studio menu, and use
  Refresh cloud projects to fetch changes from another device.
- Each successful save writes the project and a complete revision atomically via
  an RLS-respecting SECURITY INVOKER function. The server compares the last save
  receipt. Concurrent or stale writes pause with an error and preserve the draft;
  the user can explicitly save a separate cloud project. No overwrite fallback is used.
- Version history pages through complete cloud snapshots. Preview a revision and
  explicitly apply it to restore. Existing local edit logs, Undo, exports and AI
  proposal previews remain available.
- If configuration or migration 002 is missing, controls remain visible and show
  a clear error. Existing local editing/exporting continues.

## Live acceptance after configuration

Automated tests use isolated service fixtures; they do not send emails or create
production accounts. Complete these checks with test accounts you control:

1. Create an account, receive and follow confirmation, sign in, view/update its
   display name, refresh and confirm the session persists.
2. Request a reset email, follow it, set a new password and sign in with it.
   Check expired-link and invalid-password error messages too.
3. Create a cloud project, edit it, wait for Saved to cloud, then sign in with the
   same account in a second browser/device and reopen it from Overview.
4. Edit the same saved version on both devices. Save on the first, then the second;
   verify the second pauses and offers a separate copy, retaining both designs.
5. Preview and explicitly restore a history entry. Copy a selected device project
   to the account and verify the original still exists after signing out.
6. Use a second account to verify the first account's projects, history and private
   references are inaccessible, including direct guessed-ID API requests.
7. Verify sign out removes private drawings from the UI, then check existing AI,
   reference upload, readiness, floor editing and drawing exports.
