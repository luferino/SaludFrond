# Teacher clinical access and paper consent

## Contextual read access

Open **Atención clínica → Acceso clínico docente** (`/teacher-clinical`). Navigation requires the teacher/docente role and both `patient-assignments:read` and `kinesiology-evaluations:read` as presentation hints. The backend rechecks current grants and teacher context on every request.

Choose an assignment using the patient name and exact subject/group identifiers. Discovery uses the paginated teacher endpoint `/patient-assignments`, never the student's `/mine`. Each page has up to 50 assignments by default (limit 1–100, offset 0–10000). Previous remains available on a successfully loaded empty later page. Changing pages discards the selected assignment.

The selected assignment supplies patient, subject and group for the unpaginated evaluation list. All returned statuses are shown: draft, submitted and validated. Opening a record renders clinical content without create/edit/submit/review controls. Existing student draft discovery, editing and permissions are unchanged.

### Discovery limits and privacy

This entry discovers current assignments only; it is not a historical patient catalog. Origin-teacher detail authorization does not itself require a current patient assignment. The detail request uses an explicit patient/origin-subject/origin-group context and the backend's current read authorization, without calling `/mine`. Subject/group labels use their exact identifiers because this endpoint does not return their names.

Cross-context submission snapshots are outside this entry: provenance fields (`submission_id`, `submission_ordinal`, `submitted_by`, `submitted_at`, `consent`) are rejected rather than treated as editable/origin records. Status alone does not distinguish snapshots from origin records. BIGINT IDs stay strings. Responses are `no-store`; no patient document is placed in navigation URLs. Errors are not represented as empty lists.

## Paper consent

The detail page reads `/kinesiology-evaluations/:id/consent` and distinguishes **Pendiente**, **Verificado**, and an unavailable read. A failed read never becomes pending and disables recording. The last verified evidence shows the paper signature date and server-assigned verifier/time.

The explicit native form additionally needs the teacher/docente role and `kinesiology-evaluations:verify-consent`. A successful origin-only consent read is not write authority: POST rechecks the current grant and active exact origin teacher. Cross-context snapshots never reach this form. Registration is allowed independently of draft/submitted/validated state.

Enter a real calendar date in `YYYY-MM-DD`. There is no client-invented future-date or admission-date restriction. POST sends only `{paper_signature_date}`; user, timestamp, patient demographics and audit IDs are never sent as evidence fields. Both GET and POST responses use `{evaluation_id,status,evidence}`; verified evidence is `{id,paper_signature_date,verified_by,verified_at}`.

**Every POST adds a new constancy record, even if the same date is entered again.** The UI disables the first submit button and prevents a second click while submitting. No render, state read or automatic retry performs a write. Success redirects to a GET. Network errors, malformed success responses or server failures after the write attempt are uncertain outcomes: the form is hidden on that response and **Consultar estado sin registrar otra constancia** performs a GET before any new explicit decision. This is not backend idempotency and does not prevent independent tabs or deliberate repeated submissions. With JavaScript disabled, native POST works but double-click protection is unavailable; do not resend a pending request.

## Verification and boundaries

Focused API tests use in-memory fetch responses. Render tests compile actual Astro templates with isolated synthetic props and no HTTP, database, shared QA state or server. These checks do not establish browser interaction, live grants or backend availability.

No reassignment, historical catalog, submission, correction, validation, amendment, dependencies or backend changes are included. Commits, publication and shared runtime startup remain separately authorized operations.
