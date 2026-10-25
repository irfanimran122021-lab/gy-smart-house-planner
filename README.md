# GY Smart House Planner

Measured architectural drafting for Guyana, using Next.js, React, TypeScript, SVG vector geometry, Supabase and a server-side OpenAI Responses integration. This source belongs to the existing repository `irfanimran122021-lab/gy-smart-house-planner` and targets its `main` branch.

## Current capability and scope

This is a working initial drafting application, **not a finished professional architectural CAD system**. The editor and exports run without external credentials. Cloud storage, login, image interpretation and AI editing require the service configuration below. No simulated AI responses are used.

- Dashboard, project creation, native project import/export, device persistence, duplication and edit notes.
- Requirements in feet, inches, metres or millimetres; one canonical millimetre model.
- Two deterministic rectangular apartment-layout variants, one or two bedrooms and one bathroom per unit, equal units per floor. Unsupported requests fail explicitly. Free-text instructions are retained but do not automatically become geometry.
- Floor editing: select rooms/walls/openings/features, exact room dimensions, shared partition movement, independent wall drawing/length/thickness, door/window insertion, stair/veranda/label/dimension insertion, grid snap, measurement, zoom, Undo/Redo and floor duplication. Click two points for walls or measurements. Select an interior wall then use Move and drag. Existing room dimensions and dimension chains update from the model. Added walls do not automatically subdivide or relabel rooms.
- Coordinated floor/site/roof envelopes, four **schematic** elevations, a **schematic** section, opening widths schedule and general notes. Elevation opening heights and roof rise are provisional assumptions; sections are not structural construction details. Survey orientation, entrance, easements, site features and vertical levels require confirmation. The drainage sheet is a design brief, **not a generated drainage network**.
- Vector PDF with physical sheet sizes A1/A2/ARCH D, actual 1:96 floor/elevation scale and 1:192 site scale, title blocks, scale bar and stamp space. An oversized drawing fails rather than silently changing scale. PDF package includes all floors plus 10 supporting sheets.
- AutoCAD-compatible ASCII DXF in millimetres for the current sheet, SVG, 3200 px PNG and editable `.gyplan` JSON. DXF uses vector outlines/text and segmented door arcs; no parametric CAD dimensions, paper-space layouts or native DWG.
- Supabase email/password signup, login, recovery, persistent sessions, account settings and optional email links; owner-isolated cloud projects and private reference storage, version-checked automatic cloud saving and paginated revision restoration previews. Device history is a change log; cloud snapshots are restorable; session Undo holds 40 changes.
- Up to four JPG/PNG/WEBP/PDF references per AI request, 3 MB each; content signature validation, structured evidence, confidence/source display, unresolved measurements as null and explicit selection before generation. Conflicting readings are retained. Current UI interprets the four most recently attached references together.
- AI assistant returns typed proposed edits; geometry is validated and previewed before acceptance. Unsupported edits fail visibly. AI needs an authenticated Supabase user and an atomic per-user database rate limit.
- Preliminary readiness checks with configurable locally confirmed setbacks. These checks do not establish legal compliance, structural safety or government approval.

### Important limits

The requested full professional system remains broader than this implementation. Free-form polygonal room solving, arbitrary apartment configurations, room-aware auto-repartitioning of drawn walls, object rotation, fully detailed elevations/sections, engineered stair/egress verification, complete drainage/sanitation design and structural calculations are not implemented. Do not advertise these as completed. Reference extraction and cloud authorization need live credential-backed acceptance testing before service launch. The 40 × 60 ft eight-apartment request is rejected by the constrained template; this is not a proof that every professionally designed alternative is impossible.

## Local installation

Node.js 22.13+ (Node 24 recommended), pnpm 11 or npm.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open `http://127.0.0.1:3000`. Without cloud credentials, use the durable device cache and download native backups. Device storage is a convenience, not a substitute for production cloud configuration.

## Configure cloud and AI

1. Use your Supabase project. For a fresh installation, open `supabase/migrations/001_initial.sql`, copy the **entire file** into the SQL Editor, select the `postgres` role and execute it once. The transaction creates project/revision tables, owner policies, explicit grants, private reference storage and an atomic AI quota function. Existing application tables make this initial migration fail safely; if you already ran an earlier version of `001`, use a separately reviewed upgrade migration instead. Do not drop existing tables to rerun this file. See [database security and execution notes](supabase/README.md) for the full contract and test coverage. No live database was accessed during development.
2. Enable Supabase email/password authentication, confirmation/recovery redirects and production email delivery. Apply additive migration `002_cloud_saving.sql` after the initial migration. Follow [authentication setup and live acceptance](AUTH_SETUP.md) for the existing deployment. Do not rerun the initial migration over existing tables.
3. Set the environment values from `.env.example` in `.env.local` and in the **existing** Vercel project's Production and Preview environments:

| Variable                        | Purpose                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL                                                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public/anon key; access is enforced by RLS                                                 |
| `OPENAI_API_KEY`                | Secret server-only OpenAI API key                                                          |
| `OPENAI_MODEL`                  | A model available to your API account that supports image/PDF input and structured outputs |

Do not add a service-role key to this application. Do not put API keys in Git or browser-prefixed environment variables. AI endpoints authenticate the bearer session and charge a maximum of 20 calls per user per UTC hour. Configure provider billing limits and upload moderation/retention for your service before inviting customers.

4. Redeploy after changing variables. Sign in through **Your workspace**, save the project, upload references, run interpretation, inspect evidence, reconcile dimensions and generate a proposal.
5. Files are sent to OpenAI only when the signed-in user chooses interpretation. Requests use `store:false`; review the provider's account data controls and contractual retention terms for your service. Private upload removal currently unlinks a reference from the project; bucket object lifecycle/retention should be managed by the operator.

API documentation used: [Images and vision](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses), [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [PDF inputs](https://developers.openai.com/api/docs/guides/file-inputs).

## Validation

```sh
pnpm test
pnpm test:db
pnpm typecheck
pnpm build
```

The suite includes 20 application tests and database security tests against a real, disposable PostgreSQL process. `pnpm test:db` runs only the database tests. The runner always starts its own loopback-only cluster with a random password under ignored `tmp/database-tests/`, never reads `DATABASE_URL` or Supabase credentials, and stops/removes its cluster afterward. PostgreSQL binaries are test-only dependencies; their required setup scripts are allowlisted in `pnpm-workspace.yaml`. Run as a normal user (PostgreSQL does not run as Unix root). CI runs the same database tests through `pnpm test`.

Application tests cover units, setback reconciliation, floor generation, room/wall geometry, opening fit/access, unique room identities, staircase coordination, schema validation and reopening, upload validation, structured extraction schemas, assistant edit validation, wall movement, generated views, vector PDF pages, DXF units and scale preservation. Database tests exercise the unchanged migration with test-only stand-ins for Supabase's managed auth/storage schema. They cover real RLS, grants, foreign keys and concurrent transactions, but do not replace testing Supabase's JWT gateway, actual object upload/download or external AI perception accuracy. Browser QA is recorded in `VALIDATION.md`.

### Eight-apartment acceptance case

In **Project requirements**, choose **Load 8-apartment reference**. A 51 × 100 ft lot, 40 × 60 ft building and two 5 ft side setbacks must produce a 1 ft discrepancy. Four two-bedroom apartments per floor also fail this generator's reserved-circulation and room-proportion constraints. Correcting setbacks alone must not make that layout pass. Try two units per floor for a supported arrangement. Generator area/proportion thresholds are explicitly template constraints, not claimed Guyanese legal room minima.

## Official guidance and professional review

The application references [CHPA Single Window](https://chpa.gov.gy/single-window/) and [NDC Corner](https://chpa.gov.gy/ndc-corner/), reviewed 23 October 2026. The Single Window page describes required site content, black-and-white drawings, black dimension lines, specified scales and space for agency stamps. NDC guidance includes further application-dependent requirements. Setbacks must be confirmed with the responsible authority for the actual site; the app does not impose one blanket national setback rule.

Current drawings require professional assessment of boundaries, measured dimensions, circulation/egress, accessibility, ventilation, opening heights, stairs, parking, easements, services and structure. Future floors require engineering assessment. No output is marked approved or certified.

## Existing GitHub and Vercel deployment

The repository was initially empty. This is its application source; no separate GitHub repository or hosted Sites project is required.

1. Commit/push this source to `main` in `https://github.com/irfanimran122021-lab/gy-smart-house-planner.git`.
2. When you are ready, connect this existing GitHub repository to Vercel yourself. No Vercel project was created during development. Select `main` as the Production Branch, the repository root as Root Directory and Next.js as the framework preset. `vercel.json` supplies the build command. Vercel detects `pnpm-lock.yaml` for installation. The application builds and runs without Supabase or OpenAI credentials; the interface identifies those unavailable services.
3. Configure the variables and database above, then redeploy the existing project. If there is no existing Vercel project yet, the owner must connect this existing repository through Vercel; do not create a duplicate repository.
4. Verify the exact deployment result in Vercel before claiming publication. A successful Git push alone does not prove Vercel deployed successfully.

## Live acceptance checks before launch

- Two separate users cannot read/update each other's projects, revisions or bucket objects, including direct requests with guessed UUIDs.
- Signed-out AI requests are rejected; authenticated requests enforce the atomic quota; provider errors never mutate drawings.
- Test real measured sketches and PDFs, unreadable values, conflicting multi-image dimensions and refusal/error responses.
- Save/reopen projects on another signed-in device, restore a chosen revision, test expired sessions and interrupted uploads.
- Open DXFs in the intended CAD software and measure a known 40 ft edge as 12,192 mm. Print PDFs at actual size and measure 10 ft as 1.25 in at 1:96.
- Have a qualified Guyanese designer review the constrained template and exported drawing content before offering a professional drafting service.
