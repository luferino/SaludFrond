# Oral Surgery I drafts, paper consent and teacher authorization

Oral Surgery I is an Odontology form with its own backend API (`/oral-surgery-drafts`). It does not reuse the Kinesiology evaluation API or its lifecycle (there is no submission or validation step).

## Choosing the form for an assignment

`/my-patients/[assignmentId]` (student) and `/teacher-clinical` (teacher) call `GET /oral-surgery-subjects/mine` once, without query parameters, when the session carries the `oral-surgery-drafts:read` grant. The response lists the subject and academic group pairs where the caller holds an active habilitation and the subject is explicitly enabled for Oral Surgery I.

| Discovery result | What the page shows |
| --- | --- |
| The assignment's exact subject and group pair is listed | Oral Surgery I only: its drafts and, for students, **Crear nuevo borrador de Cirugía Oral I**. No Kinesiology request is made. |
| Pair not listed (including an empty list), or no grant in the session | The Kinesiology view, unchanged. The page does not claim the subject is Kinesiology; that module keeps its own permissions and backend checks. |
| 403 | A permission notice and no Oral Surgery actions; the Kinesiology view is unchanged. |
| 401 | Redirect to login. |
| Any other failure or a malformed response | An alert and no clinical actions at all, to avoid creating the wrong form. |

Subjects are never inferred from their names and no subject ID is hardcoded. Each page lists at most the 50 most recent drafts of the context and says so when the limit is reached.

## Student draft editor

`/oral-surgery-drafts/[id]?assignment_id=<id>&limit=50&offset=0` revalidates the active assignment and requires the draft's patient, origin subject and origin group to match it. Editing is offered only to the author with a student role and the `oral-surgery-drafts:write` grant; these session claims are presentation hints and the backend rechecks every write.

- **Create**: each click on the create button sends one POST and opens a new clinical encounter. Existing encounters are resumed from the list, never recreated. A failed create whose outcome is unknown asks the student to check the list before trying again.
- **Content**: `admission_date` plus six sections (medical history, complementary tests, extraoral exam, intraoral exam, preoperative evaluation, treatment plan). Yes/No questions offer *Sin responder*, *Sí* and *No*; text answers accept up to 4000 characters.
- **Save**: the form replaces the whole content and sends the `expected_version` the student loaded. Before the PATCH, the action reads the current draft. Empty controls keep the stored representation of an unanswered question (absent stays absent, `null` stays `null`, `''` stays `''`); clearing an answer stores `null`. An untouched save therefore never changes the treatment plan, which would otherwise invalidate the paper consent declaration.
- **Stale version**: if another tab or person saved first, nothing is stored. The page shows the current version in the form and the unsaved values in a separate read-only panel for copying; it never resubmits them automatically.
- **Unknown outcome**: a network failure or server error after the PATCH is reported as unconfirmed, never as saved.

## Signed paper consent declaration

The student declares that the patient signed the consent on paper for the saved treatment plan. **It is not an electronic signature and no document is uploaded.** The section lists the declaration history (oldest first, with each treatment plan snapshot) and the current declaration. The declaration form appears only when there is no current declaration and the editor has no unsaved changes; it sends one POST bound to the saved version.

Any change to the stored treatment plan, including going back to an earlier plan, requires a new declaration. Edits to other sections keep the current declaration.

## Teacher authorization

`/teacher-clinical/oral-surgery/[id]?patient_id=…&subject_id=…&academic_group_id=…` shows the draft read-only with its origin context, current version, consent history and authorization history (each entry with the reviewed content). Teachers reach it from `/teacher-clinical` after choosing an assignment in an enabled context.

The **Autorizar esta versión** form appears only with the `oral-surgery-drafts:authorize` grant, a current consent declaration, and no authorization for the current version. It requires the checkbox *Verifiqué el consentimiento firmado en papel* and sends one POST binding the exact version and declaration. Every student save, even of identical content, makes a new authorization necessary; the page states when the current version is not authorized. If the draft changes while the page loads, the form is hidden until the teacher reloads. Administrators never authorize.

## Not included

Operative reports, grading, attachments, patient electronic signatures and the administrative screen to enable subjects. Verification uses isolated synthetic fixtures; it does not prove a running backend or real data.
