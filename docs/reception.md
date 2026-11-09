# Reception workflows

Reception accounts (role `reception`) work only inside careers they have been explicitly granted: `kinesiology` and `odontology`. Each career needs its own active grant; there is no implicit second career. Backend authorization is authoritative: navigation and page role checks are presentation hints only, and the backend re-checks the role and the live career grant on every request.

Reception never reaches clinical records, consents, users, academic catalogs, habilitations, or student assignments. The sidebar for a `reception` session shows only the **Recepción** section; academic, people and clinical links are hidden. The pages never fall back to the global `/patients` or `/patient-availabilities` endpoints.

## Reception accounts (admin)

`/reception-accounts` (admin only, linked under **Personas**) creates `reception` accounts with `POST /auth/accounts` and manages per-career access through `GET`/`POST /auth/accounts/:userId/careers` and `POST /auth/career-grants/:grantId/revoke`. The grants list shows active and revoked periods; revoking requires explicit confirmation. A duplicate username or email, or an already active grant for that career, is reported as a conflict without showing backend messages.

The backend has no endpoint that lists reception accounts. An account is therefore managed right after creation (the returned id becomes the selected account) or by entering its UUID (`?account_id=`). An unknown UUID shows an empty grants list. The page never uses student or teacher listings as a substitute.

## Reception patients

`/reception/patients` lets a `reception` account work with institutional patients for each career it has been granted. Careers are read from `GET /reception/careers` on every render and nothing is cached: a career is used only when it appears in that fresh list and in `?career=`. Zero granted careers shows a notice and makes no patient request. With a granted career the page loads `GET /reception/patients?career=` only (the backend returns a fixed first page; there is no pagination).

Document lookup (`POST /reception/patients/match`, 4–8 digits) never reveals the matched patient's identity. An existing institutional patient must be linked explicitly with **Vincular** (`POST /reception/patients/reuse`) before it appears in the career's list; linking never overwrites identity. A document with no match offers registration (`POST /reception/patients/register`) prefilled with that document. Only email, phone and address are edited, via `PATCH /reception/patients/:id?career=`; identity and birth-date corrections stay with administration.

A 404 on a career-scoped operation shows a neutral "career no longer enabled or patient not in that career" message without revealing activity from other careers. Backend messages are never displayed, and only a 401 clears the session.

## Availability

`/reception/availability` uses the same fresh career selection. Reception searches a patient enrolled in the selected career by exact document (4–8 digits, `GET /reception/availability/search`; the document is sent through a form action and never placed in the URL), enables availability on one of that career's subject/group contexts (`GET /reception/availability/contexts`, `POST /reception/availability`), reviews the patient's availability history (`GET /reception/availability/history`) and withdraws an active period after explicit confirmation (`POST /reception/availability/:id/withdraw`).

Contexts and history are paginated with `contexts_limit`/`contexts_offset` and `history_limit`/`history_offset` (limit 1–100, offset 0–10000, no totals). History entries carry no labels, so subject and group names come from the contexts page on screen; other entries show neutral labels. The patient's name appears only right after a search in the same request; otherwise the page shows "Paciente seleccionado" to keep names out of URLs.

Withdrawing availability keeps the patient–career link and does not assign patients to students; teacher assignments stay with teachers. A 404 means the career is no longer enabled, the patient is not enrolled in it, or the context or period belongs to another career; a 409 means an active availability already exists. There is no fallback to the global patient-availability endpoints.

## Verification

Automated coverage uses scripted fetch mocks with synthetic identifiers (`tests/reception-accounts.test.mjs`, `tests/reception-patients.test.mjs`, `tests/reception-availability.test.mjs`, `tests/dashboard.test.mjs`). Live behavior against the backend is part of the deferred manual end-to-end check; local test credentials stay in the backend repository and are never copied here.
