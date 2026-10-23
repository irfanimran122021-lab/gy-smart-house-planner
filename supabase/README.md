# Initial database migration: security and execution

`migrations/001_initial.sql` is ready for a **fresh Supabase installation**. It was executed and tested in disposable local PostgreSQL 18.4 clusters; no live Supabase database was connected to or modified. SQL uses standard PostgreSQL features also available in Supabase's supported PostgreSQL 15+ versions. The managed `auth` and `storage` schemas and normal Supabase roles/grants must already exist.

## Run through the SQL Editor

1. Open your intended Supabase project, then SQL Editor. Use the `postgres` database role.
2. Confirm this project's `public.projects`, `public.project_revisions` and `public.ai_usage` tables have **not** already been installed. This is an initial migration, not an upgrade script.
3. Copy and execute the entire `001_initial.sql` file, including `begin` and `commit`, in one run. Do not execute individual excerpts.
4. The script checks the managed Storage grants and RLS configuration first. If these prerequisites are missing, it raises an explicit error instead of changing Supabase-managed grants/table ownership.
5. On error, no partial changes should be committed. If your SQL Editor session remains in an aborted transaction, run `rollback;`, correct the reported issue and rerun the whole file. Do not drop existing data or ignore errors to force installation.
6. Review the resulting tables, policies and private `references` bucket in Supabase. After configuring the app, test with two real user accounts before launch.

There are no extension installs, credentials, hardcoded user IDs, database resets or changes to global default privileges in the migration. A pre-created `references` bucket is explicitly set private with the 3 MB limit and accepted MIME types; its objects are not deleted. Policies for unrelated buckets are preserved. If you previously installed the original migration, stop and prepare a separate upgrade migration that checks existing data before adding the composite foreign key.

## Access contract

| Object                     | Signed-in client access                                | Enforcement                                                                                                                     |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `projects`                 | Select, insert, update/upsert, delete own rows         | Explicit table grants plus RLS `USING` and `WITH CHECK` on `owner_id`                                                           |
| `project_revisions`        | Read and append snapshots for own existing projects    | Both row owner and parent project owner checked; no client update, delete or truncate grant                                     |
| Revision ownership         | Must match parent project, including privileged writes | Non-null composite FK `(project_id, owner_id)` to unique `projects(id, owner_id)`                                               |
| Parent deletion            | Owner may delete their project and its snapshots       | Composite FK cascades deletion; deleting an auth user cascades through their projects                                           |
| Parent ownership/ID change | Cannot orphan or reassign existing snapshots           | FK `ON UPDATE RESTRICT` blocks ownership/key changes while revisions exist                                                      |
| `ai_usage`                 | No direct client reads/writes/resets                   | All client/PUBLIC table privileges revoked; RLS enabled without client policies                                                 |
| `consume_ai_request()`     | Only `authenticated` receives execute permission       | No parameters for selecting another user/window; trusted owner `postgres`; empty search path; qualified objects                 |
| `references` objects       | Read, upload and delete own UID-prefixed paths         | Private bucket and authenticated policies, plus a restrictive namespace guard applying even alongside broad permissive policies |
| Reference updates/moves    | Denied; upload with `upsert:false`                     | Restrictive update policy blocks both updates out of and moves into the reference bucket                                        |

`anon` has no grants on the application tables or execution permission on the RPC. Trusted administrators and `service_role` retain their normal privileged database/Storage role; RLS is not a barrier against a privileged administrator or leaked service-role secret. The app does not require a service-role key.

Supabase manages `storage.objects` privileges and RLS. The migration verifies the standard authenticated SELECT/INSERT/DELETE privileges rather than revoking or granting shared-table access that might affect other buckets. A metadata `owner_id` supplied by a caller does not authorize a reference: the first path component must equal the verified JWT's `auth.uid()`. Files without that prefix are rejected. Project-folder names organize files; they do not grant access to another user's project. MIME/byte-size limits are bucket settings enforced by the Storage service; SQL tests verify those settings, not the HTTP file-upload implementation.

## Atomic quota behavior

The quota is **20 accepted calls per user per fixed UTC clock hour**, not a sliding 60-minute window. The function uses the current statement time, independent of the session timezone. A unique `(owner_id, window_start)` key serializes concurrent calls. Its single `INSERT ... ON CONFLICT DO UPDATE ... WHERE requests < 20` statement returns true only when a row was inserted or incremented. Once full, it returns false without incrementing or rewriting the counter row. Constraints also reject counters outside 1–20 or non-hour window starts.

The security-definer body pins `search_path = ''`, schema-qualifies relations/functions/types, reads identity only from `auth.uid()`, and has no dynamic SQL. Execution is revoked from PUBLIC, `anon` and `service_role`; only `authenticated` is granted execute. It intentionally exposes this narrow, zero-argument RPC, not arbitrary privileged SQL or quota data. The server integration already treats false as HTTP 429 and does not invoke the AI provider for rejected requests.

## Reproducible local tests

```sh
pnpm install --frozen-lockfile
pnpm test:db
pnpm test
pnpm typecheck
pnpm build
```

`tests/database.test.ts` always creates its own PostgreSQL cluster on `127.0.0.1`, on a temporary port, with a random test password. It accepts no external connection URL, creates no OS user and verifies its temporary directory before cleanup. `tests/fixtures/supabase.sql` provides only the managed-schema interface needed by the migration; **never run that fixture in Supabase**.

Tests verify fresh execution, bucket configuration, default-grant revocation, owner upsert, foreign project access, revision insertion/read/immutability, invalid privileged ownership writes, ownership transfer restrictions, independent revision read checks, cascading deletes, function permissions/search-path shadowing, sequential quota rejection without row rewrites, 80 concurrent calls yielding exactly 20 accepts, 40 concurrent calls at a count of 19 yielding exactly one accept, per-user isolation, UTC boundaries across session timezones, private storage isolation, broad-policy resistance, other-bucket behavior, safe rejection of reruns, managed-prerequisite failures, and complete rollback after an intentionally injected late migration error.

Live Supabase authentication, Storage API object bytes/signed URLs and provider integration still require a configured deployment and account-level acceptance testing. No local fixture test claims to verify those external services.

## Official references reviewed

- [Supabase database functions and security-definer guidance](https://supabase.com/docs/guides/database/functions)
- [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [PostgreSQL INSERT / ON CONFLICT concurrency behavior](https://www.postgresql.org/docs/current/sql-insert.html)
