# Amending a validated kinesiology evaluation

A student can amend a **validated** initial kinesiology evaluation. The amendment is a new draft that starts from the validated content and then follows the normal draft, submission and teacher review flow. The original record, its submissions and its review stay unchanged.

## Flow

- `/kinesiology-evaluations/[id]?assignment_id=<assignmentId>&limit=50&offset=0` shows **Crear enmienda** on a validated record of the assignment's own patient, subject and academic group, to a student with the `kinesiology-evaluations:write` grant. The student does not need to be the original author: a replacement student with an active habilitation and assignment in the origin context can amend. Cross-context readers, teachers and admins never see the control. These checks only decide what the UI shows; the backend rechecks habilitation, assignment and status.
- The student must tick an explicit confirmation checkbox. The action `createKinesiologyAmendment` accepts only `id`, `assignment_id`, `limit`, `offset` and `confirm`.
- Before the POST, the action checks the active assignment, the record identity and context, and that the status is `validated`. A mismatch is refused locally and nothing is sent.
- The action sends `POST /kinesiology-evaluations/:id/amendments` with an empty body `{}` exactly once, with no automatic retry. A browser guard ignores a second click.
- After a confirmed `201`, the page redirects to the **new** draft through the context the action validated (`...&amended=1`) and shows **Enmienda creada**. The draft is edited with the usual save (`PATCH`) and sent with **Enviar ficha guardada**; the backend reuses the original verified paper consent. Teachers validate it or request corrections as with any submission.
- Any record carrying `amendment_of_evaluation_id` shows a note linking to the validated original.
- The backend accepts several amendments of the same original (product decision: keep it). The UI adds no duplicate-prevention rule, and the confirmation text says that each confirmation creates a separate amendment.

## Outcomes

| Backend result | Shown to the student |
| --- | --- |
| `201` with a draft whose `amendment_of_evaluation_id` is the original id, a new id, and the same patient, subject and group | Redirect to the new draft |
| `409 only a validated evaluation can be amended` | Only a validated record can be amended |
| `409 validated submission is unavailable` | The validated version is unavailable |
| `401` / `403` / `404` | Sign-in redirect / no permission to amend / not available in this context |
| Other `4xx` | Not created; check the status before trying again |
| Network failure, `408`, `429`, `5xx`, a malformed `201`, or a `201` outside the confirmed context | **Uncertain**: the form is hidden and the student is asked to check the assignment's drafts before trying again, because each attempt can create a new amendment; never reported as success |
