# CampusGuide — frontend

Student web app for **CampusGuide — Multimodal Assistive AI System for Context-Aware Guidance** at
**NMAM Institute of Technology (NMAMIT), Nitte**. The UI follows `docs/reference/campusguide-ui-reference.webp`.

> **Backend:** connected to the NestJS API in `../backend` when `VITE_API_BASE_URL` is set. Without it, every feature
> that needs the server shows an honest "not connected" state. Nothing is faked: no demo accounts, sample results or
> generated answers. The assistant has no backend endpoint yet.

## Run

```bash
npm install
cp .env.example .env.local   # set VITE_API_BASE_URL=http://localhost:3000/api
npm run dev                  # http://localhost:5173 (start ../backend first: npm run start:dev)
```

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run preview` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest + Testing Library |
| `npm run qr:generate` | Development utility only: writes sample QR images to `docs/qr/`. Real codes are generated in the app (Super Admin → QR Management, College Admin → QR Codes). |

Configuration (`.env.local`, see `.env.example`): `VITE_API_BASE_URL` (backend including `/api`; empty = not connected)
and `VITE_CAMPUS_IMAGE_URL` (optional licensed campus photo; empty = built-in illustration). Both are public — secrets
belong only in `backend/.env`. The backend's `FRONTEND_ORIGIN` must equal this app's origin for CORS and the cookie.

## Screens and routes

| Reference screen | Route | Notes |
|---|---|---|
| 1 Student home (before QR) | `/home` (also `/`) | Banner, quick access, announcements, help |
| 2 Scan NMAMIT QR code | `/scan` | Camera + image-upload fallback, torch/camera switch when supported |
| 3 NMAMIT dashboard (after QR) | `/admission` | College strip, **Your Admission Details** (name, rank, branch, year, fees), quick links |
| 4 More admission resources | `/resources` | Resource list + "Need Further Help?" |
| 5 Required documents | `/documents` | Open before scanning; tabs; provisional example checklist |
| 6 Admission process | `/admission-process` | Numbered timeline (general guidance) |
| 7 Fee structure | `/fees` | Official PDF: https://nitte.edu.in/fee/BTECH.pdf |
| 8 Ask CampusGuide | `/assistant` | Chat UI; needs the QR context |
| — | `/result`, `/profile` | Check My Result, account status — **sign-in required** (redirects to `/login` and back) |
| — | `/help`, `/login`, `/signup`, `/forgot-password` | Help, sign-in, registration, reset request |
| — | `/verify-email`, `/reset-password` | Targets of the emailed links (`#token=…`, removed from the address bar on arrival) |

Everything else — home, documents, admission process, fees, resources, scan — is public by design.

## Staff portals (one shared login)

`/login` is the same page for students and staff; there is no role picker. After sign-in the app reads the role the
backend returns and opens the right portal (`/dashboard` does the same): students → `/home`, College Admins →
`/admin/dashboard`, Super Admins → `/super-admin/dashboard`. Route guards only steer navigation; the backend checks the
role on every request. Staff accounts are activated from an emailed link at `/activate#token=…`.

The admin UI follows `docs/reference/campusguide-admin-ui-reference.webp` (navy sidebar, white cards, blue accents).

| Portal | Route | Page |
|---|---|---|
| College Admin | `/admin/dashboard` | Totals, records per year (chart), recent imports, import outcomes, data quality, activity |
| | `/admin/students`, `/admin/students/:id` | Search / filter / sort / page records; details, change history, confirmed edit with reason |
| | `/admin/imports/new` → `/admin/imports/:id` | Upload → validation results → review & duplicate policy → import result, CSV report |
| | `/admin/imports`, `/admin/admission-years` | Import history; per-year overview of the shared admissions table |
| | `/admin/qr-codes` | QR Codes: preview and download (PNG/SVG) of the college’s codes — read-only |
| | `/admin/profile` | Settings & Profile |
| Super Admin | `/super-admin/dashboard` | College Admin counts, invitations, recent administrative activity |
| | `/super-admin/college-admins` | Invite (name + email), resend / revoke invitations, suspend / restore access |
| | `/super-admin/qr-codes` | QR Management: create placements, preview, download PNG/SVG, activate / deactivate (confirmed), recent QR audit events |
| | `/super-admin/audit-log`, `/super-admin/profile` | Read-only audit log; Settings & Profile |

Every number and row comes from the API — loading, empty, error and "not connected" states are shown instead of
sample data. Staff services live in `src/services/admin/*`; shared admin components in `src/components/admin/*`.

## How the admission result is protected

1. The student signs in (server session, HttpOnly cookie).
2. They scan the NMAMIT QR. It only establishes the **college context**: `campusguide:college/nmamit?area=<desk>`.
   It never contains identity, results or instructions, and anything else is rejected without being displayed.
3. The app immediately asks the backend for this account's admission details — no login form, email field or
   reference prompt. It sends only the college id and QR area.
4. The backend checks the session, re-checks that the college and QR placement are still active, and finds the
   official record whose email equals the **signed-in account's verified email** (newest admission year; two records
   in that year = "contact the admission office"). The browser never sends a student ID, email or result.
5. Only then are the name, NUCAT rank, allocated branch, admission year and the backend-calculated fee shown, with the
   **Verified Record** badge. Under "Fees to be paid" only the backend's **Final payable amount** is shown (no
   breakdown, category or scholarship details); without a confirmed amount the card says "Fee information requires
   confirmation. Please check the official fee structure or contact the admission office." The official fee PDF link
   is shown in both cases.

## Backend integration

Implementations live in `src/services/*` (`apiRequest` in `services/http.ts` is the single typed client: it sends
`credentials: 'include'`, maps the backend's error `code`s, hides 5xx details and signals expired sessions).
Contract verified against `backend/src` controllers and DTOs; see the backend README / Swagger (`/api/docs`).

| Purpose | Request | Response used |
|---|---|---|
| Register / resend link | `POST /auth/register` `{ email, password }`, `POST /auth/resend-verification` `{ email }` | `202 { message }` (generic); `503 EMAIL_PROVIDER_NOT_CONFIGURED` shown as an error |
| Verify email | `POST /auth/verify-email` `{ token }` (after a click on `/verify-email`) | `{ verified: true }`, or `INVALID_OR_EXPIRED_TOKEN` |
| Log in / out | `POST /auth/login` `{ email, password, rememberMe }`, `POST /auth/logout` | `{ student, expiresAt }` + HttpOnly cookie; `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED` |
| Session | `GET /auth/me` | `{ student: { id, email, emailVerified, createdAt } }`; 401 = signed out |
| Password reset | `POST /auth/forgot-password` `{ email }`, `POST /auth/reset-password` `{ token, password }` | generic `202`; `{ passwordReset: true }` signs out everywhere |
| QR context | `POST /qr-context/validate` `{ payload }` | `{ collegeId, collegeName, shortName, area }`, or `INVALID_QR` |
| Admission details | `GET /students/me/admission-details?collegeId=&area=` | `{ details }`; `404 NO_ADMISSION_RECORD`, `409 AMBIGUOUS_ADMISSION_RECORD`, `400 INVALID_QR` |

```ts
interface AdmissionDetails {
  studentName: string
  nucatRank: number | null        // null = not published
  allocatedBranch: string | null  // null = not yet allocated
  admissionStatus: string | null
  admissionYear: number | null
  fee:                            // calculated only by the backend fee service
    | { status: 'CONFIRMED'; currency: 'INR'; finalPayableAmount: number }   // whole rupees, not a balance
    | { status: 'REQUIRES_CONFIRMATION' }
}
```

The session cookie is never readable by JavaScript and nothing about the session is kept in browser storage (only the
non-sensitive QR college context, in `sessionStorage`). Any `UNAUTHENTICATED` answer signs the student out with a
"session ended" notice. Responses are validated before display (`parseAdmissionDetails`, `parseStudent`). Tests inject
services through `ServicesProvider`; `src/services/apiContract.test.ts` checks the HTTP services against the backend's
response shapes.

## Content

Admission text is data in `src/content/` with provenance labels. The document checklist is a **provisional
example** and the process steps are **general guidance**; no dates, deadlines or policies are invented. Replace
them with official content (or a content API) when available.

## Structure

```
src/
  app/          providers: services, session, QR college context
  components/
    app/        AppLayout, Sidebar, Topbar, WelcomeBanner, QuickAccessCard, AnnouncementPanel, HelpCard, ...
    admission/  AdmissionResultCard
    assistant/  ChatPanel
    content/    DocumentChecklist, AdmissionTimeline, FeeStructureCard
    scanner/    QrScanner, useQrCamera
    auth/ layout/ ui/ visual/   login page (with lazy 3D scene)
  content/      editable admission content
  pages/        login pages; pages/app/* for the eight screens and extras
  services/     typed service interfaces + HTTP / not-connected implementations
docs/           UI reference image, generated QR codes
```
