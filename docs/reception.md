# Reception workflows

Reception accounts (role `reception`) work only inside careers they have been explicitly granted: `kinesiology` and `odontology`. Each career needs its own active grant; there is no implicit second career. Backend authorization is authoritative: navigation and page role checks are presentation hints only, and the backend re-checks the role and the live career grant on every request.

Reception never reaches clinical records, consents, users, academic catalogs, habilitations, or student assignments. The sidebar for a `reception` session shows only the **Recepción** section; academic, people and clinical links are hidden. The pages never fall back to the global `/patients` or `/patient-availabilities` endpoints.

## Reception patients

`/reception/patients` lets a `reception` account work with institutional patients for each career it has been granted. Careers are read from `GET /reception/careers` on every render and nothing is cached: a career is used only when it appears in that fresh list and in `?career=`. Zero granted careers shows a notice and makes no patient request. With a granted career the page loads `GET /reception/patients?career=` only (the backend returns a fixed first page; there is no pagination).

Document lookup (`POST /reception/patients/match`, 4–8 digits) never reveals the matched patient's identity. An existing institutional patient must be linked explicitly with **Vincular** (`POST /reception/patients/reuse`) before it appears in the career's list; linking never overwrites identity. A document with no match offers registration (`POST /reception/patients/register`) prefilled with that document. Only email, phone and address are edited, via `PATCH /reception/patients/:id?career=`; identity and birth-date corrections stay with administration.

A 404 on a career-scoped operation shows a neutral "career no longer enabled or patient not in that career" message without revealing activity from other careers. Backend messages are never displayed, and only a 401 clears the session.

## Verification

Automated coverage uses scripted fetch mocks with synthetic identifiers (`tests/reception-patients.test.mjs`, `tests/dashboard.test.mjs`). Live behavior against the backend is part of the deferred manual end-to-end check; local test credentials stay in the backend repository and are never copied here.
