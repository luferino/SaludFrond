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

Version history, teacher validation, correction requests, resubmission and amendments are out of scope for this slice.
