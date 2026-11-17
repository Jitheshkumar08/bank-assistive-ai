# CampusGuide — backend

NestJS 12 + TypeScript (ESM) + PostgreSQL + Prisma 7 API for CampusGuide (`../frontend`): the NMAMIT student portal,
the **College Admin** portal (official admission imports and records) and the **Super Admin** staff management.
It ships **no official admission data** and never fabricates results — admission records come only from imports.

## Quick start

```bash
cd backend
npm install
cp .env.example .env            # then set DATABASE_URL (see "Database setup")
npm run db:migrate:deploy       # apply migrations (never resets data)
npm run db:seed                 # NMAMIT institution context only (no students, no admission data)
npm run start:dev               # http://localhost:3001/api   ·   Swagger: http://localhost:3001/api/docs (PORT=3001; Banking uses 3000)
```

| Command | Purpose |
|---|---|
| `npm run start:dev` / `npm run build` + `npm start` | Development (watch) / production build and run |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript |
| `npm test` | Unit tests (no database) |
| `npm run test:e2e` | End-to-end tests against the disposable `_test` database |
| `npm run db:migrate:dev -- --name <change>` | Create a new migration in development (review the SQL before committing) |
| `npm run db:migrate:deploy` · `npm run db:status` | Apply pending migrations · show status |
| `npm run build` then `npm run admin:bootstrap -- --email … --name "…"` | One-time Super Admin provisioning (see below) |
| `npm run build` then `npm run fees:load -- --file data/fee-schedules/<file>.json` | Load a **confirmed** official fee schedule (see "Fees") |

Requires Node.js ≥ 22.12 (NestJS 12 is ESM-only) and PostgreSQL (developed on 18.1).

## Database setup

Use a dedicated, least-privilege role — never the `postgres` superuser — in `DATABASE_URL`. As a PostgreSQL
superuser (`psql -U postgres`), with your own strong password:

```sql
CREATE ROLE campusguide_app LOGIN NOSUPERUSER NOCREATEROLE CREATEDB PASSWORD '<strong password>';
CREATE DATABASE campusguide_dev  OWNER campusguide_app;
CREATE DATABASE campusguide_test OWNER campusguide_app;   -- disposable, used only by npm run test:e2e
REVOKE ALL ON DATABASE campusguide_dev, campusguide_test FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE campusguide_dev, campusguide_test TO campusguide_app;
```

`CREATEDB` is only for Prisma's temporary shadow database during `migrate dev`. Put the test database URL in
`.env.test` (same keys as `.env`, `NODE_ENV="test"`); the e2e tests **refuse to run unless the database name ends in
`_test`** and only ever truncate that database. Migrations are applied with `migrate deploy`, never `migrate reset`.

## Environment variables (`.env`, validated at startup)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://…/campusguide_dev?schema=public`; the `.env.example` placeholder is rejected |
| `FRONTEND_ORIGIN` | yes | The **public app URL**: exact origin for CORS, email links and every generated QR code, e.g. `http://localhost:5174` locally. In production it must be the deployed `https://` address — localhost and private IPs are refused at startup. Never derived from request headers. |
| `NODE_ENV` | | `development` (default), `test`, `production` |
| `PORT` | | default `3000` |
| `SESSION_TTL_HOURS` / `REMEMBER_ME_DAYS` | | default 12 h / 30 days |
| `EMAIL_TRANSPORT` | | `none` (default) · `smtp` · `dev-outbox` (development only; refused in production) |
| `SMTP_URL`, `EMAIL_FROM` | for `smtp` | e.g. `smtps://user:pass@smtp.example.com:465` |
| `SWAGGER_ENABLED` | | unset = on except in production |
| `RATE_LIMIT_AUTH` / `RATE_LIMIT_EMAIL` / `RATE_LIMIT_IMPORT` | | requests per 15 min per client (default 10 / 5 / 30 file uploads) |
| `ADMISSION_IMPORT_COLUMN_ALIASES` | | extra spreadsheet header names as JSON, e.g. `{"nucatReference":["NUCAT Appl No"]}` |

With `EMAIL_TRANSPORT=none`, registration, resend-verification and forgot-password return **503
`EMAIL_PROVIDER_NOT_CONFIGURED`** — nothing is reported as sent. With `dev-outbox`, messages (with their links) are
written to `./.dev-outbox/` (git-ignored) for local testing only.

## Roles and the one-time Super Admin setup

One login (`POST /api/auth/login`) for everyone. The account's **role comes from the database** (`StudentAccount.role`)
and is returned as `student.role`; the frontend uses it only to choose a portal, and **every endpoint checks the role
server-side** (`@Auth(...)` = session guard + roles guard, 403 `FORBIDDEN` otherwise).

| Role | How it is created | Can |
|---|---|---|
| `STUDENT` | Public registration (always; a `role` field in the request is rejected) | Verify and view their own admission result |
| `COLLEGE_ADMIN` | Invited by a Super Admin; activated through the emailed single-use link | Import admissions and manage records **of their own college** |
| `SUPER_ADMIN` | Once, with the bootstrap command below | Invite / suspend / restore College Admins, read the audit log |

Roles are never derived from email domains, never chosen by the user, and an existing account is never upgraded by an
invitation (staff need a new email address). A College Admin cannot reach any Super Admin route.

**Provision the first Super Admin** (server-side shell + database access required; there is no HTTP route for it):

```bash
npm run build
npm run admin:bootstrap -- --email it-admin@your-college.edu --name "Full Name"
```

The command refuses to run once any Super Admin exists, never takes or prints a password or token, and emails a
single-use activation link (72 h) through the configured email provider (`EMAIL_TRANSPORT=smtp`; in development the
message lands in `.dev-outbox/`). The person opens `/activate#token=…`, sets a password of **at least 16 characters**
(College Admins: 12) and then signs in at `/login`. A pending link can be replaced with `--replace-pending`. Both the
invitation and the activation are written to the audit log.

## Admission imports (College Admin)

Upload `.xlsx` or `.csv` (max 5 MB, 10,000 rows) for one admission year → the server parses (ExcelJS / RFC-4180 CSV),
validates and stores a **preview** (nothing official changes) → the admin reviews counts and row messages → confirms
with an explicit duplicate policy (`SKIP_EXISTING` or `UPDATE_EXISTING`) → one transaction applies it.

- **Recognised columns** (headers matched by name, case/punctuation ignored; `GET /api/admin/admission-imports/columns`):
  NUCAT Reference\*, Student Name\*, Admission Year (must equal the chosen year), NUCAT Rank, Branch, Status, Email,
  Fee Category (`General` / `Scholarship` / `NRI`; header "Fee Category" or "Fee Type" only — a plain "Category"
  column is deliberately not used, as official sheets may use it for reservation categories).
  Unknown columns are ignored and listed. Extra header names: `ADMISSION_IMPORT_COLUMN_ALIASES`.
- **Rows are rejected, never guessed**: missing/invalid values, a year that differs from the selected one, and every
  occurrence of a reference that appears twice in the file. Blank optional cells never clear stored values.
- **Commit safety**: a batch can be confirmed once (concurrent/repeated commits get 409 `IMPORT_ALREADY_PROCESSED`);
  previews expire after 24 h; if records changed after the preview (or the unique constraint trips) the whole
  transaction rolls back, the batch is marked failed and nothing is written (409 `IMPORT_STALE`).
- Every created/updated record gets an audit entry (with field-level before/after for updates); the batch keeps row
  results for the history page and the CSV report (cells starting with `= + - @` are neutralised).

## QR codes (QR Management)

A placement (`InstitutionQrCode`: college + location id `areaSlug` + label + active flag) is what a printed code points
to. The payload format is unchanged — `campusguide:college/<college>?area=<location id>` — and identifies only the
place, never a student. Images generated in the app encode it as a scan link, `${FRONTEND_ORIGIN}/scan?qr=<payload>`, so
a phone's own camera opens CampusGuide; the in-app scanner and `POST /api/qr-context/validate` accept both the link
(only for this deployment's origin, path `/scan`, single `qr` parameter) and the bare payload, so codes printed before
QR Management keep working. Every scan re-checks that the college and placement are active.

- **Super Admin** (`/api/super-admin/qr-codes`): list all, create (`POST`, 409 on a duplicate location id per college),
  `POST :id/activate` / `:id/deactivate` (never deletes), `GET :id/qr.png` / `:id/qr.svg`. Creation and status changes
  write `QR_PLACEMENT_CREATED` / `_ACTIVATED` / `_DEACTIVATED` audit events (`/api/super-admin/audit-events?entityType=InstitutionQrCode`).
- **College Admin** (`/api/admin/qr-codes`): list and `GET :id/qr.png|svg` for their own college only; no write routes.
- Images are rendered in memory per request (`qrcode` library) from the stored placement — no files on disk, no
  user-supplied URLs or SVG. The location id cannot change after creation, so re-downloading never changes a code.
- `npm --prefix frontend run qr:generate` remains only as an offline development utility.

## Fees (official schedule → backend fee service)

Fee amounts live in `FeeSchedule` (per institution, admission year, programme, category) and come only from a file in
`data/fee-schedules/` transcribed from the official Nitte fee document (source URL + SHA-256 recorded). `fees:load`
refuses a file whose `confirmation.status` is not `CONFIRMED` (with `confirmedBy` / `confirmedOn`), upserts rows in one
transaction, never deletes, and writes a `FEE_SCHEDULE_LOADED` audit event.

Rules (`src/fees/fee-calculation.ts`, tested): fee = annual tuition for the record's **fee category** in its
**allocated branch** and **admission year** + the annual exam fee (collected each year with tuition). Branch names
match programme names case-insensitively with `&` = "and"; extra names can be added as `aliases`. Anything missing —
no branch, no category, no schedule row, two matching rows, or "NA" in the document — returns
`REQUIRES_CONFIRMATION` with a reason, never an amount. There is no payment data, so no balance is ever reported.

Scholarship: the official document prints the **Scholarship** fee for each programme directly (it is already net of the
scholarship). A confirmed scholarship is therefore the official **Fee Category = Scholarship** on the imported record
plus that Scholarship schedule row; no deduction is derived from the General fee, assumed from rank, or applied on top,
and a record without a category is never treated as General.

Student API (`GET /api/students/me/admission-details` → `details.fee`): `toStudentFee` reduces the internal result to
`{ "status": "CONFIRMED", "currency": "INR", "finalPayableAmount": 360000 }` or `{ "status": "REQUIRES_CONFIRMATION" }` —
no tuition/exam breakdown, category, programme, source or reason. Every input comes from the session's own matched
record; fee or scholarship values in the request are rejected (400).

## Data model (prisma/schema.prisma)

- `StudentAccount` — every login account: email (unique), Argon2id hash, `emailVerifiedAt`, status, lockout counters,
  **`role`**, staff `displayName`, College Admin `institutionId`. (Name kept from the first milestone.)
- `StaffInvitation` — pending staff access: role, college, SHA-256 token hash, expiry, accepted/revoked.
- `StudentSession`, `AccountToken` — server-side sessions and single-use email tokens (hashes only).
- `Institution`, `InstitutionQrCode` — college context and approved QR placements.
- `AdmissionRecord` — **one table for every admission year**: `admissionYear`, normalised `nucatReference`,
  `studentName`, `nucatRank`, `allocatedBranchId → Branch`, `admissionStatus`, `officialEmail`; linked to at most one
  student account. Unique per **(institution, admissionYear, nucatReference)**.
- `AdmissionImportBatch`, `AdmissionImportRow` — uploads, their counts/status and per-row validation results.
- `AuditEvent` — append-only (a database trigger rejects UPDATE/DELETE).

**Uniqueness decision (needs official confirmation).** NUCAT is held every year and nothing confirms that reference
numbers are unique across years, so records are unique per year: the same reference in 2024 and 2025 is two records,
and importing one year can never overwrite another. If the official rules guarantee global uniqueness, this can be
tightened later. The applicant's email in the official data is what lets a student claim a record; without it the
student cannot verify online (the import warns about such rows).

**Migrations** (`prisma/migrations`, applied with `npm run db:migrate:deploy`, never reset):
`…_init`, `20261023100000_roles_invitations_admission_imports` (additive; it stops with a clear error instead of
inventing an `admissionYear` if admission rows already exist), `20261023100100_audit_append_only`.

## Security model

- Passwords: Argon2id (19 MiB, t=2, p=1); never stored or logged in plain text; unknown emails cost the same time.
- Sessions: random 256-bit token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` + `__Host-` prefix in
  production); only its hash is stored; expiry, logout revocation, and sign-out-everywhere on password reset.
- Only verified, active accounts can sign in or use protected routes. Identity always comes from the session; request
  bodies that include extra fields such as `studentId` are rejected.
- No account enumeration: register / resend / forgot-password give the same answer for every email; login gives the
  same error for unknown email and wrong password. 10 wrong passwords lock the account for 15 minutes.
- Authorisation by the role stored on the account, checked on every request; College Admin queries are always scoped to
  their own college; suspending a staff account ends its sessions immediately.
- Rate limits on auth, email and upload endpoints (in-memory per instance; use a shared store before scaling out).
- Uploads: 5 MB multipart limit, type checked by extension and content, row/column/cell limits, files are not stored
  (only their SHA-256 and the parsed rows).
- Helmet headers, 100 KB JSON limit, CORS restricted to `FRONTEND_ORIGIN`, foreign-`Origin` writes rejected,
  strict DTO validation, Prisma parameterised queries, transactions for multi-step changes, audit events without secrets.

## API (prefix `/api`; full schema in Swagger at `/api/docs`, JSON at `/api/docs-json`)

| Method & path | Auth | Result |
|---|---|---|
| `GET /health` | — | `200 {status:'ok', database:'ok'}` or `503` |
| `POST /auth/register` `{email, password}` | — | `202 {message}` (generic) · `503` if email unavailable |
| `POST /auth/resend-verification` `{email}` | — | `202 {message}` (generic) |
| `POST /auth/verify-email` `{token}` | — | `200 {verified:true}` · `400 INVALID_OR_EXPIRED_TOKEN` |
| `POST /auth/login` `{email, password, rememberMe?}` | — | `200 {student, expiresAt}` + session cookie · `401 INVALID_CREDENTIALS` · `403 EMAIL_NOT_VERIFIED` |
| `POST /auth/logout` | cookie | `204` (revokes session, clears cookie) |
| `GET /auth/me` | cookie | `200 {student}` · `401 UNAUTHENTICATED` |
| `POST /auth/forgot-password` `{email}` | — | `202 {message}` (generic) |
| `POST /auth/reset-password` `{token, password}` | — | `200 {passwordReset:true}` · `400` |
| `POST /qr-context/validate` `{payload}` | — | `200 {collegeId, collegeName, shortName, area}` · `400 INVALID_QR` |
| `GET /students/me/admission-details?collegeId=nmamit&area=admissions-desk` | cookie (STUDENT) | `200 {details}` (record found by the session account's email; fee from the fee service) · `404 NO_ADMISSION_RECORD` · `409 AMBIGUOUS_ADMISSION_RECORD` · `400 INVALID_QR` (college or QR placement inactive) |
| `GET /students/me/admission-result?collegeId=nmamit` | cookie | `200 {result}` · `404 NOT_VERIFIED` (kept; the Student Portal now uses admission-details) |
| `POST /students/me/admission-verification` `{collegeId, nucatReference}` | cookie | `200 {result}` · `400 REFERENCE_MISMATCH` |
| `POST /assistant/messages` `{message, language, collegeId, area?, inputMode?, history?}` | cookie (STUDENT) | `200 {text, language, intent, outcome, steps, studentContext}` · `400 VALIDATION_FAILED` (any student field in the body) · `400 INVALID_QR` · `503 ASSISTANT_UNAVAILABLE` — Phase 6, see `docs/domain-integration/06-college-backend-integration.md` |
| `POST /assistant/voice-messages` multipart `{audio, language, collegeId, area?}` | cookie (STUDENT) | `200 {…same as messages, transcript}` · `400 VALIDATION_FAILED` / `INVALID_FILE` / `INVALID_QR` · `413 FILE_TOO_LARGE` (5 MB) · `422 VOICE_NOT_UNDERSTOOD` · `503 ASSISTANT_UNAVAILABLE` — Phase 7, see `docs/domain-integration/07-college-voice-input.md` |
| `POST /assistant/speech` `{text}` | cookie (STUDENT) | `200 audio/*` (only a reply this session was given) · `400` · `503 ASSISTANT_UNAVAILABLE` |
| `POST /auth/invitations/inspect` · `POST /auth/invitations/accept` `{token, password}` | link token | staff activation (role from the invitation) |

Student endpoints require role `STUDENT`. Staff APIs (full schema in Swagger):

| Area (role) | Endpoints |
|---|---|
| Super Admin (`SUPER_ADMIN`) | `GET /super-admin/overview` · `GET /super-admin/college-admins` · `POST /super-admin/college-admins/invitations` · `POST …/invitations/:id/resend` · `POST …/invitations/:id/revoke` · `POST /super-admin/college-admins/:id/suspend` · `POST …/:id/restore` · `GET /super-admin/audit-events` |
| College Admin (`COLLEGE_ADMIN`, own college only) | `GET /admin/dashboard` · `GET /admin/student-records` (search, year, branch, status, sort, page) · `GET /admin/student-records/filters` · `GET /admin/student-records/:id` · `PATCH /admin/student-records/:id` (reason + `expectedUpdatedAt` required) · `GET /admin/student-records/:id/history` · `GET /admin/admission-years` |
| Imports (`COLLEGE_ADMIN`) | `GET /admin/admission-imports/columns` · `GET …/template.csv` · `POST /admin/admission-imports/preview` (multipart `file`, `admissionYear`) · `GET /admin/admission-imports` · `GET …/:id` · `GET …/:id/rows` · `GET …/:id/report.csv` · `POST …/:id/commit` `{duplicatePolicy}` · `POST …/:id/cancel` |

```ts
// Public student (never includes hashes, tokens or lockout data)
interface Student { id: string; email: string; emailVerified: boolean; createdAt: string }

// Admission result — only the signed-in student's own, from imported official records
interface AdmissionResult {
  studentName: string
  nucatRank: number | null        // null = not published
  allocatedBranch: string | null  // null = not allocated
  admissionStatus: string | null
  verifiedAt: string
}

// Every error
interface ApiErrorResponse { statusCode: number; code: string; message: string; details?: { field: string; messages: string[] }[]; requestId: string }
```

Email links point to `${FRONTEND_ORIGIN}/verify-email#token=…` and `/reset-password#token=…` (token in the URL
fragment); the frontend pages that read them and call the API are not built yet. Requests from the browser must use
`credentials: 'include'`.

## Deferred / needs confirmation

- Official spreadsheet layout and NUCAT reference rules (column names, global vs per-year uniqueness, status vocabulary).
- Real email delivery (configure SMTP) — required for staff invitations and the Super Admin bootstrap in production.
- Additional Super Admins (only the first is provisioned, by design), self-service staff password change while signed
  in (use "forgot password"), multi-instance rate-limit store, social login. (The AI assistant endpoints exist since Phase 6.)
