# Authentication and cloud saving

## Investigating a confirmed account that cannot sign in

On 17 November 2026, the production site's public JavaScript and public Auth
settings showed project `zzqadafqlkavpryskwut` at
`https://zzqadafqlkavpryskwut.supabase.co`. The anon key's project reference matched
that host. Email authentication and signups were enabled, and automatic email
confirmation was disabled (confirmation remains required). No keys are recorded
here. The account dialog now displays only the authentication server's hostname
so the operator can compare it with the dashboard containing the existing user.

This verifies the deployed project/key pairing, not that the user's intended
dashboard is the same project. Compare its Settings → Data API Project URL or the
project reference in the dashboard URL with the host above. If different, update
the existing Vercel project's Production `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` together using the intended project's browser-safe
key, then redeploy. Do not delete or recreate users/projects to resolve this.

The existing login calls `signInWithPassword`, trims the email, and deliberately
does not trim or change passwords. `Invalid login credentials` is returned by
Supabase, not project RLS. A confirmed email is not proof that the entered password
matches that account; previous magic-link/invited users may need to set a password.
If the project matches, use **Sign in → Forgot password?** with the existing
account email. Follow the newest reset email, set a new password yourself, sign
out, then sign in with that password. This preserves the account UUID and its data.
Never send passwords or recovery links/tokens to a developer or paste them in chat.

Verify these settings in the **existing** Supabase project:

1. Authentication → Sign In / Providers → Email: keep Email enabled and
   **Confirm email enabled**. Do not disable confirmation to fix a password error.
2. Authentication → URL Configuration: Site URL must be
   `https://gy-smart-house-planner.vercel.app`. Add these Redirect URLs:
   `https://gy-smart-house-planner.vercel.app/` and
   `https://gy-smart-house-planner.vercel.app/?auth=recovery`.
3. Authentication → Email Templates: the Confirm signup and Reset password
   links should use `{{ .ConfirmationURL }}` to perform Supabase verification
   before redirecting. A link to `{{ .SiteURL }}` alone does not verify a token.
   Keep the verification link intact; do not paste access tokens into templates.
4. If email does not arrive, inspect Authentication logs and the project's SMTP
   configuration, spam folder and email rate limits. Delivery and the private
   redirect allowlist cannot be inspected using the public browser key.

No dashboard settings, accounts, passwords, tables or RLS policies were changed
by this update. No new migration is required for these authentication changes.

The app captures confirmation/recovery intent before the SDK removes the URL
fragment, including dashboard links with no app-specific query flag. Recovery
requires an SDK session; expired/error links do not open the new-password form
even if an older session exists. Successful recovery preserves a non-secret
`auth=recovery` marker for refresh; token/error fragments are removed from the
address bar after the SDK has processed them. Existing signup emails may still
use the unchanged root redirect. Resend confirmation is available on Sign in.

Official references: [Password authentication](https://supabase.com/docs/guides/auth/passwords),
[redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

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
