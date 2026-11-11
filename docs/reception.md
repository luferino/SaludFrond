# Reception workflows

Reception accounts (role `reception`) work only inside careers they have been explicitly granted: `kinesiology` and `odontology`. Each career needs its own active grant; there is no implicit second career. Backend authorization is authoritative: navigation and page role checks are presentation hints only, and the backend re-checks the role and the live career grant on every request.

Reception never reaches clinical records, consents, users, academic catalogs, habilitations, or student assignments. The sidebar for a `reception` session shows only the **Recepción** section; academic, people and clinical links are hidden. The pages never fall back to the global `/patients` or `/patient-availabilities` endpoints.

## Reception accounts (admin)

`/reception-accounts` (admin only, linked under **Personas**) creates `reception` accounts with `POST /auth/accounts` and manages per-career access through `GET`/`POST /auth/accounts/:userId/careers` and `POST /auth/career-grants/:grantId/revoke`. The grants list shows active and revoked periods; revoking requires explicit confirmation. A duplicate username or email, or an already active grant for that career, is reported as a conflict without showing backend messages.

Administrators can find accounts by a literal, case-insensitive substring of username or email (trimmed, at most 100 characters), and optionally filter to a career with an active grant. Results are paginated (50 by default, up to 100 per page, offsets up to 10000); the UI offers next/previous navigation without claiming a total and hides the next link once it would pass offset 10000. Form actions keep their framework `_action` query parameter without invalidating the search. Each result shows username, email when available, and active careers. Selecting a result uses its account UUID internally; search terms are not copied into that selection link. A newly created account remains selected automatically. The backend never returns roles or creation timestamps in search results, and its authorization remains authoritative. The page never uses student or teacher listings as a substitute.

### Additional Reception role for Students

The **Rol de Recepción adicional** section on the same page lets an administrator give a Student account the extra Reception role without creating a new account. Students are found only by a non-empty username or email search (`GET /auth/reception-role-candidates`, 20 per page, no blank listing of all Students). Selecting one shows its role state from `GET /auth/accounts/:userId/reception-role`: «Recepción activa», «Recepción revocada» or «Sin rol de Recepción». **Habilitar Recepción** calls `POST /auth/accounts/:userId/reception-role`; a 409 reports that the Reception role is already active.

Revoking (`POST /auth/reception-role-grants/:grantId/revoke`) needs explicit confirmation and warns that all of the Student's Reception careers are revoked too; a later regrant starts without careers. Careers for a dual-role account are still managed with the career grants above («Gestionar carreras de esta cuenta»), and account search lists dual-role accounts with their active careers. Role and career forms keep the current `student_q`/`student_id` query, so the result names the selected Student. The Student switches roles from the header; see `docs/active-role.md`.

## Reception patients

`/reception/patients` lets a `reception` account work with institutional patients for each career it has been granted. Careers are read from `GET /reception/careers` on every render and nothing is cached: a career is used only when it appears in that fresh list and in `?career=`. Zero granted careers shows a notice and makes no patient request. With a granted career the page loads `GET /reception/patients?career=` only (the backend returns a fixed first page; there is no pagination).

Document lookup (`POST /reception/patients/match`, 4–8 digits) never reveals the matched patient's identity. An existing institutional patient must be linked explicitly with **Vincular** (`POST /reception/patients/reuse`) before it appears in the career's list; linking never overwrites identity. A document with no match offers registration (`POST /reception/patients/register`) prefilled with that document. Only email, phone and address are edited, via `PATCH /reception/patients/:id?career=`; identity and birth-date corrections stay with administration.

A 404 on a career-scoped operation shows a neutral "career no longer enabled or patient not in that career" message without revealing activity from other careers. Backend messages are never displayed, and only a 401 clears the session.

## Availability

`/reception/availability` uses the same fresh career selection. Reception searches a patient enrolled in the selected career by exact document (4–8 digits, `GET /reception/availability/search`; the document is sent through a form action and never placed in the URL), enables availability on one of that career's subject/group contexts (`GET /reception/availability/contexts`, `POST /reception/availability`), reviews the patient's availability history (`GET /reception/availability/history`) and withdraws an active period after explicit confirmation (`POST /reception/availability/:id/withdraw`).

Contexts and history are paginated with `contexts_limit`/`contexts_offset` and `history_limit`/`history_offset` (limit 1–100, offset 0–10000, no totals). History entries carry no labels, so subject and group names come from the contexts page on screen; other entries show neutral labels. The patient's name appears only right after a search in the same request; otherwise the page shows "Paciente seleccionado" to keep names out of URLs.

Withdrawing availability keeps the patient–career link and does not assign patients to students; teacher assignments stay with teachers. A 404 means the career is no longer enabled, the patient is not enrolled in it, or the context or period belongs to another career; a 409 means an active availability already exists. There is no fallback to the global patient-availability endpoints.

## Verification

Automated coverage uses scripted fetch mocks with synthetic identifiers (`tests/reception-accounts.test.mjs`, `tests/reception-role-grants.test.mjs`, `tests/reception-patients.test.mjs`, `tests/reception-availability.test.mjs`, `tests/dashboard.test.mjs`). Live behavior against the backend is part of the deferred manual end-to-end check; local test credentials stay in the backend repository and are never copied here.
