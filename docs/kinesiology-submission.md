# Submitting an initial kinesiology evaluation

A student can submit their saved initial kinesiology draft so it becomes an immutable, read-only submitted record.

## Flow

- `/kinesiology-evaluations/[id]?assignment_id=<assignmentId>&limit=50&offset=0` shows **Enviar ficha** only to the draft's author, a student with the `kinesiology-evaluations:write` and `kinesiology-evaluations:submit` grants, in a matching active assignment. These checks only decide what the UI shows. The backend still makes the final decision.
- Submission sends only the **last saved version**. The action sends `POST /kinesiology-evaluations/:id/submissions` with an empty body `{}`. Form contents are never sent, and saving never happens implicitly. If any field changes after the page loads, or the page is showing values kept from a failed save, the button is disabled or hidden and the student is asked to save first.
- Before the POST, the action checks the assignment, the evaluation identity and the draft status again. A mismatch is refused locally and nothing is sent.
- The POST runs once, with no automatic retry. A browser guard ignores a second click.
- After a confirmed `201`, the page redirects through the context the action validated (`...&submitted=1`). It then shows the record's **Estado de la ficha** and that it can no longer be edited.
- `/my-patients/[assignmentId]` keeps the draft list unchanged and adds **Fichas enviadas**, which lists the submitted and validated records for the same patient, subject and academic group.

## Outcomes

| Backend result | Shown to the student |
| --- | --- |
| `201` with a valid snapshot (`status: pending_validation`, matching `evaluation_id`, consent snapshot) | Confirmed submission |
| `400` | Saved content is incomplete |
| `409 evaluation has already been submitted` | Already submitted |
| `409 verified paper consent is required before submission` | Verified consent is required |
| `401` / `403` / `404` | Sign-in redirect / no permission / not available |
| Other `4xx` | Not submitted; check the status before trying again |
| Network failure, `408`, `429`, `5xx`, or a malformed `201` | **Uncertain**: the submit form is hidden and the student is asked to check the status before trying again; never reported as success |

## Version history (read-only)

- `/kinesiology-evaluations/[id]` shows **Historial de versiones** for submitted and validated records, and for an author's draft reopened after a correction request. An original draft without correction events keeps its initial-draft presentation and no history section.
- The list comes from `GET /kinesiology-evaluations/:id/submissions` (`listSubmissions`). The envelope must echo the requested `evaluation_id`; items must be ordered by `ordinal` without duplicates; an empty `items` list is valid. Submission ordinals accept the API's positive decimal strings (PostgreSQL bigint) as well as positive safe-integer numbers. Ordering compares integer values, not text, without losing bigint precision; malformed ordinals still fail closed. Correction reasons are joined to snapshots by their exact decimal-string `submission_id`; immutable snapshot status is not changed. There is no per-submission detail endpoint, so each version renders from the list.
- Each version uses the shared read-only `SubmissionSnapshot` component: ordinal, submission time, status (**Pendiente de validación** or **Validada**), patient demographics and age at admission, clinical content, the top-level `studies` only, and the consent snapshot (paper signature date, verifier, verification time). A snapshot never renders a form.
- Submission-history and correction-history failures show separate errors. The record and its status stay visible, and the page never reports "no versions" after a failed load or treats a failed correction read as proof that a draft can be resent.
- Correction reasons are requested only in the verified origin assignment for the original student author; cross-context latest-snapshot readers do not request or receive them. Ended assignments and replacement students do not gain edit or resubmit access.
- After a correction request, the author can edit and save the reopened draft. **Reenviar versión guardada** appears only after the origin correction history confirms that the draft has a correction event and existing author/active-assignment/permission checks pass. Resubmission still sends one empty-body POST of the saved content; it never saves implicitly, sends unsaved fields, retries, or treats a conflict as success. Dirty edits block resubmission until saved or explicitly discarded back to the saved page.
- The backend stays the authority for every read and mutation; the grant checks in the UI are hints only.

Teacher-side review and correction requests are described in [teacher-clinical-access-consent.md](teacher-clinical-access-consent.md).
