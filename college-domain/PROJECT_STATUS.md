# CampusGuide — Project Status & Handoff (2026-10-27)

Final-year project: **Multimodal Assistive AI System for Context-Aware Guidance (CampusGuide)**, scope = NMAMIT admissions only.
Folder: `Desktop\Institution` (not a git repo). Detailed docs: `backend/README.md`, `frontend/README.md`.

## Stack and how to run
| Part | Tech | Command | URL |
|---|---|---|---|
| Backend | NestJS 12 (ESM) + Prisma 7.10.1 + PostgreSQL 18 | `npm --prefix backend run start:dev` | http://localhost:3000/api (Swagger `/api/docs`) |
| Frontend | React 19 + TS 6 + Vite 8 | `npm --prefix frontend run dev` | http://localhost:5173 |

- DB: `campusguide_dev` (role `campusguide_app`; creds only in `backend/.env`), disposable `campusguide_test` (`backend/.env.test`). Never reset dev.
- Migrations: `init`, `roles_invitations_admission_imports`, `audit_append_only` — all applied. Apply with `npm --prefix backend run db:migrate:deploy`.
- Email: `EMAIL_TRANSPORT=dev-outbox` → messages written to `backend/.dev-outbox/` (no real sending). SMTP not configured.
- `frontend/.env.local`: `VITE_API_BASE_URL=http://localhost:3000/api`.

## Built so far
**Student Portal** — public: `/home`, `/documents`, `/fees`, `/admission-process`, `/resources`, `/help`, `/scan`, `/login`, `/signup`, `/forgot-password`, `/verify-email`, `/reset-password`. Login required (STUDENT): `/result`, `/profile`, `/admission`, `/assistant` (redirect to login and back). Log in / Sign up buttons in top bar. QR scan = college context only.
**Languages** — Student Portal in English / ಕನ್ನಡ / हिन्दी (`frontend/src/i18n/`: `en.ts`, `kn.ts`, `hi.ts`, provider, selector). Saved in localStorage `campusguide.language`; survives refresh/login/logout. Admin portals and `/activate` forced English. Tulu paused (`tcy` kept in assistant type).
**Auth** — one login for all roles; role from DB decides landing: STUDENT→`/home`, COLLEGE_ADMIN→`/admin/dashboard`, SUPER_ADMIN→`/super-admin/dashboard`. Argon2id, HttpOnly session cookie, rate limits, email verification, password reset. Backend `@Auth(role)` guards every endpoint.
**College Admin portal** (`/admin/*`) — dashboard, student records (search/filter/sort/edit with reason + history), Excel/CSV import (upload → validate → review → confirm, single transaction, duplicate policy, per-year uniqueness), import history, admission years, profile.
**QR → personalised admission details** (2026-10-27) — after a valid QR scan, `/admission` (and `/result`) call `GET /api/students/me/admission-details?collegeId=&area=` with the session cookie only; no login/email/reference prompt. Backend matches the record by the session account's verified email (newest year; same-year duplicates → 409 AMBIGUOUS), re-checks QR placement, read-only. Fee from `src/fees` (FeeSchedule table, `npm run fees:load`), shown to the student only as the **final payable amount** (2026-11-06: API `fee` = `{status, currency, finalPayableAmount}` or `{status:'REQUIRES_CONFIRMATION'}`; breakdown/category/reason stay in the backend; Scholarship = the official Scholarship row, no derived deduction), or "Fee information requires confirmation. Please check the official fee structure or contact the admission office". New optional import column "Fee Category" (General/Scholarship/NRI). Migration `20261027140000_fee_schedule` (additive) applied to dev + test; dev backup `C:\Users\navee\Documents\campusguide-backups\campusguide_dev_before_fee_schedule_2026-10-27.dump`.
**QR Management** (2026-10-27) — Super Admin `/super-admin/qr-codes` (create placement, preview, PNG/SVG download, activate/deactivate with confirmation, recent QR audit events); College Admin `/admin/qr-codes` (own college, preview + download only; backend has no write routes for them). Images rendered in memory by the backend from the stored placement. New codes encode `${FRONTEND_ORIGIN}/scan?qr=campusguide:college/<id>?area=<slug>` (phone camera opens the app); old bare-payload codes still scan. Migration `20261028090000_qr_placement_creator` (adds nullable `createdById`) applied to dev + test; dev backup `C:\Users\navee\Documents\campusguide-backups\campusguide_dev_before_qr_management_2026-10-27.dump`. Existing placement `admissions-desk` unchanged.
**Super Admin portal** (`/super-admin/*`) — invite/resend/revoke College Admins, suspend/restore, audit log. First Super Admin only via `npm --prefix backend run admin:bootstrap -- --email … --name "…"` (refuses if one exists). Audit log append-only (DB trigger).

## Tests (last run 2026-11-06, all passing)
Frontend `npx vitest run --maxWorkers=2` 203/203 (slow machine: use maxWorkers=2) · lint · `tsc -b` · build.
Backend `npm test` 75/75 · `npm run test:e2e` 122/122 (uses `campusguide_test` only) · lint · typecheck · build.

## Accounts in campusguide_dev (now)
| Email | Role | State |
|---|---|---|
| smoke.test@example.com | STUDENT | active, verified (test account; use Forgot password) |
| integration.test.1023@example.com | STUDENT | active, verified (test account; use Forgot password) |
| nnm23is104@nmamit.in | SUPER_ADMIN | active, verified — invitation accepted (verified in DB 2026-10-27) |
| naveensprabhu999@gmail.com | COLLEGE_ADMIN | active, verified — invited by the Super Admin, invitation accepted |
| nnm23is139@nmamit.in | STUDENT | active, verified (registered via /signup) |

Backup before the earlier student-account removal: `C:\Users\navee\Documents\campusguide-backups\campusguide_dev_before_student_removal_2026-10-23T07-54-47-016Z.dump`.

## Not built / open items
- AI assistant backend (`POST /api/assistant/messages`), intent detection, workflows, speech-to-text, text-to-speech — none exist; chat shows "not connected" and "voice not available".
- Real SMTP email.
- **Deployment for printed QR codes**: not deployed yet. Set backend `FRONTEND_ORIGIN` to the public https address (startup refuses localhost/private IPs in production) before printing codes; codes downloaded now open `http://localhost:5173` and only work on this machine.
- Frontend scanner only knows the college `nmamit` (`approvedColleges` in `frontend/src/services/qr/qrContext.ts`); a placement for another college would need that list extended.
- `npm audit` (backend, existing deps): high-severity advisories in `body-parser` and `multer` — `npm audit fix` available, not applied.
- Official NMAMIT spreadsheet columns, NUCAT reference uniqueness rules (currently unique per year), official status values — need confirmation.
- **Fee schedule not loaded yet**: `backend/data/fee-schedules/nmamit-btech-2026-27.json` (NMAMIT rows of the 2026-27 PDF) is `PENDING`. A person must check every amount against https://nitte.edu.in/fee/BTECH.pdf, set `CONFIRMED` + name + date, then `npm --prefix backend run build` and `npm --prefix backend run fees:load -- --file data/fee-schedules/nmamit-btech-2026-27.json`. Until then every student sees "Fee information requires confirmation".
- Needs confirmation: official branch names in the allotment list vs fee-PDF programme names (add `aliases` if they differ, e.g. "Computer Science and Engineering" vs "Computer Science"); how the fee category (General/Scholarship/NRI) is decided and whether it is in the official sheet; that NUCAT 2026 admissions use the 2026-27 schedule; fees for later years of study.
- campusguide_dev holds only **10 fictional TEST DATA records** (2026-11-05): `campusguide_dummy_admissions_2026_27.csv` imported through `AdmissionImportService` (preview → commit, SKIP_EXISTING) as the College Admin; refs `NC-2026-0001`…`0010`, Status `TEST DATA`, emails `*.test@example.com`, year 2026; 6 branches were created by the import. Originals of the dummy files: `dummy-data-originals/`. Dev backup before it: `C:\Users\navee\Documents\campusguide-backups\campusguide_dev_before_dummy_import_2026-11-05.dump`. None of the 10 emails has an account yet (sign up + verify via `/signup` and `backend/.dev-outbox/`). Remove these records before importing the official sheet. Flow verified in `backend/test/dummy-dataset.e2e-spec.ts` (test DB only).
- Native-speaker review of Kannada/Hindi text (including the new admission-details and fee text).
- Optional: change PostgreSQL `pg_hba.conf` from `trust` to `scram-sha-256`.

## Working rules the user set
Institution/NMAMIT scope only · inspect before changing · never print secrets/tokens · never reset/drop DBs or delete accounts without explicit approval (backup first) · never fabricate admission data or fake success · roles never from email addresses · admin portals stay English.
