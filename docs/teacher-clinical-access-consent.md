# Teacher clinical access and paper consent

## Contextual read access

Open **Atención clínica → Acceso clínico docente** (`/teacher-clinical`). Navigation requires the teacher/docente role and both `patient-assignments:read` and `kinesiology-evaluations:read` as presentation hints. The backend rechecks current grants and teacher context on every request.

Choose an assignment using the patient name and exact subject/group identifiers. Discovery uses the paginated teacher endpoint `/patient-assignments`, never the student's `/mine`. Each page has up to 50 assignments by default (limit 1–100, offset 0–10000). Previous remains available on a successfully loaded empty later page. Changing pages discards the selected assignment.

The selected assignment supplies patient, subject and group for the unpaginated evaluation list. All returned statuses are shown: draft, submitted and validated. Opening a record renders clinical content without create/edit/submit/review controls. Existing student draft discovery, editing and permissions are unchanged.

### Discovery limits and privacy

This entry discovers current assignments only; it is not a historical patient catalog. Origin-teacher detail authorization does not itself require a current patient assignment. The detail request uses an explicit patient/origin-subject/origin-group context and the backend's current read authorization, without calling `/mine`. Subject/group labels use their exact identifiers because this endpoint does not return their names.

Cross-context submission snapshots are outside this entry: provenance fields (`submission_id`, `submission_ordinal`, `submitted_by`, `submitted_at`, `consent`) are rejected rather than treated as editable/origin records. Status alone does not distinguish snapshots from origin records. BIGINT IDs stay strings. Responses are `no-store`; no patient document is placed in navigation URLs. Errors are not represented as empty lists.

## Origin version history (read-only)

After the origin read succeeds, the detail page shows **Historial de versiones** from `GET /kinesiology-evaluations/:id/submissions`. `listTeacherSubmissions` runs the origin guard (`getTeacherEvaluation`) first, so a rejected origin never requests the list. Every version appears as a read-only `SubmissionSnapshot`: ordinal, submission time, status, demographics, clinical content, the top-level `studies` only, and the consent snapshot as data. Snapshots never render the consent form. The consent form and its double-submit protection are unchanged.

A history failure shows its own error (`No se pudo cargar el historial de versiones`) while the origin record and consent state stay visible. No history is requested for a denied or rejected origin.

Correction reasons are read separately from `GET /kinesiology-evaluations/:id/corrections`, after the same exact origin check. Each event is joined to its immutable snapshot by `submission_id`; only that version displays the reason, reviewer and request time. A correction-read failure has a separate error and is never presented as an empty list. The annotation is read-only and does not change the snapshot's pending/validated status. These reasons remain origin-only; this read does not use student assignment discovery or `/mine`.

### Teacher validation and correction requests

On an origin detail page, a teacher/docente with the exact `kinesiology-evaluations:review` grant can act only on the last validated history item when the current evaluation is `submitted` and that item is still `pending_validation`. The validation form sends only the evaluation/origin context and targeted `submission_id` to `POST /kinesiology-evaluations/:id/validations`; the correction form adds a required, trimmed, non-empty reason and sends it to `POST /kinesiology-evaluations/:id/corrections`. No active student assignment is required. History errors, empty history, non-submitted evaluations, and read-only grants never expose these forms. Earlier corrected snapshots remain pending in their immutable history but are not actionable. The action rechecks the exact origin, current status and latest target before making one backend-authorized write.

A confirmed response redirects to a GET using the action-validated evaluation and origin context. The backend remains authoritative for races and final authorization. Known backend rejections are failures, not idempotent success. Network/server errors or malformed success responses are uncertain: review controls stay hidden in that response, and the user must explicitly refresh/consult the record before deciding on another action. Each review form has its own double-submit guard; there is no client-side fetch or automatic retry. A failed correction preserves the entered reason where the action result is available.

## Paper consent

The detail page reads `/kinesiology-evaluations/:id/consent` and distinguishes **Pendiente**, **Verificado**, and an unavailable read. A failed read never becomes pending and disables recording. The last verified evidence shows the paper signature date and server-assigned verifier/time.

The explicit native form additionally needs the teacher/docente role and `kinesiology-evaluations:verify-consent`. A successful origin-only consent read is not write authority: POST rechecks the current grant and active exact origin teacher. Cross-context snapshots never reach this form. Registration is allowed independently of draft/submitted/validated state.

Enter a real calendar date in `YYYY-MM-DD`. There is no client-invented future-date or admission-date restriction. POST sends only `{paper_signature_date}`; user, timestamp, patient demographics and audit IDs are never sent as evidence fields. Both GET and POST responses use `{evaluation_id,status,evidence}`; verified evidence is `{id,paper_signature_date,verified_by,verified_at}`.

**Every POST adds a new constancy record, even if the same date is entered again.** The UI disables the first submit button and prevents a second click while submitting. No render, state read or automatic retry performs a write. Success redirects to a GET. Network errors, malformed success responses or server failures after the write attempt are uncertain outcomes: the form is hidden on that response and **Consultar estado sin registrar otra constancia** performs a GET before any new explicit decision. This is not backend idempotency and does not prevent independent tabs or deliberate repeated submissions. With JavaScript disabled, native POST works but double-click protection is unavailable; do not resend a pending request.

## Verification and boundaries

Focused API tests use in-memory fetch responses. Render tests compile actual Astro templates with isolated synthetic props and no HTTP, database, shared QA state or server. These checks do not establish browser interaction, live grants or backend availability.

No reassignment, historical catalog, student submission action, amendment, dependencies or backend changes are included. Student rework and explicit resubmission remain separate follow-up work. Commits, publication and shared runtime startup remain separately authorized operations.
