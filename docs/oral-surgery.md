# Oral Surgery I drafts, paper consent, teacher authorization and operative report

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

When the same subject and group are also enabled for Hygiene and Preventive Dentistry II, both forms are shown in separate sections; see [Hygiene and Preventive Dentistry II](hygiene-preventive.md).

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

## Operative report (student)

Each encounter has at most one operative report, written by the draft's author on the student editor page (`/oral-surgery-drafts/[id]`). It records what was done: procedure narrative, asepsis (extraoral, intraoral), anesthesia (technique, drug, dose), extraction (teeth, technique, suture), prescription (medications, commercial name, route, dose, frequency, duration), postoperative instructions and operative incidents. Every field is free text of up to 4000 characters, and **incomplete reports can be saved**: the frontend applies no completeness rule and no grade.

- **Prerequisite**: saving needs a current teacher authorization for the exact clinical version shown. Without one, the page says so and offers no save button; the backend rejects the save anyway.
- **Create and edit**: the first save sends one POST bound to the clinical version (`expected_draft_version`); later saves send one PATCH with both the report version (`expected_version`) and the clinical version. Each save replaces the whole report. Empty controls keep the stored representation (absent stays absent, `null` stays `null`, `''` stays `''`); clearing an answer stores `null`.
- **Clinical version changes**: saving the clinical draft creates a new version. The report then has to be saved again against the new version (after a new authorization) before the teacher can close it; the page shows a notice while the versions differ.
- **Conflicts**: if the clinical draft or the report changed, a report already exists, or the report was closed, nothing is stored. The page shows the current report and lists the unsaved values separately for copying. A missing authorization keeps the typed values in the form.
- **Unknown outcome**: a network failure or server error after the write is reported as unconfirmed, never as saved, and is never retried automatically. Because the write may have landed, the page shows the stored report (so the next save carries its current version) and lists the submitted values separately for copying.
- **Unreadable report**: if the report cannot be loaded, closure is unknown. The page shows the clinical draft read-only and offers no draft save, consent declaration or report form until a reload reads the report.

## Teacher closure

The teacher page (`/teacher-clinical/oral-surgery/[id]`) shows the report read-only. The **Cerrar parte quirúrgico** form appears only with the `oral-surgery-drafts:close` grant, an open report saved against the current clinical version, and the checkbox *Revisé el parte quirúrgico y confirmo que está listo para cerrarse. El cierre es irreversible.* It sends one POST with both exact versions. The teacher, not an automatic check, decides that the report is ready.

If the report was saved against an older clinical version, the page asks the student to save it again and offers no close form. Rejections (stale versions, a report that no longer matches the clinical version, a missing report, missing context or wrong role) are shown with their own message; an unconfirmed outcome asks the teacher to check the state before trying again.

## Closed encounters

Closure is irreversible. Once the report is closed:

- The student sees the clinical draft and the report read-only, without save or consent-declaration forms.
- The teacher sees no authorization or close form; consent and authorization histories stay visible.
- Both pages show who closed the report and when.
- If a page was opened before the closure, the backend rejects the late save, declaration or authorization (`closed oral surgery encounter is immutable`) and the page asks to reload.

## Administrator consultation

Administrators with `oral-surgery-drafts:read` reach **Cirugía Oral I** from the navigation (`/oral-surgery-admin`). The list shows the most recent encounters across every context, with optional date filters and previous/next pages (no totals). Each encounter opens a read-only detail (`/oral-surgery-admin/[id]`) with the clinical content, consent declarations, authorizations, the operative report with its closure and the practical evaluation with its correction history. The list itself does not show whether a report is closed; the detail does. Administrators never edit, authorize, close or grade.

## Practical evaluation

After the operative report is closed, a teacher grades the encounter with the paper form's fixed rubric (20 points). The grade is stored apart from the clinical record: grading never changes the draft, the report or the authorizations.

| Item | Max |
| --- | --- |
| Bioseguridad: hand washing, barrier elements, disposal of elements (one point each) | 3 |
| Clinical table set up and complete instruments | 2 |
| Applies asepsis | 1 |
| Instructor's questionnaire and anamnesis | 3 |
| Anesthetic technique | 2 |
| Sindesmotomy and use of elevators | 2 |
| Sequential surgical procedure, extraction without teacher intervention | 3 |
| Curettage and suture | 2 |
| Records the procedure, leaves equipment and instruments in order | 1 |
| Relationship with teacher, patient and staff | 1 |

- **Who grades**: a teacher with `oral-surgery-drafts:grade` and an active habilitation in the encounter's original subject and group, from the teacher page (`/teacher-clinical/oral-surgery/[id]`). The form appears only when the report is closed and no grade exists. Every item must be scored; there is no extra confirmation because a grade can be corrected.
- **Live preview**: while the teacher scores, the page shows the running total and the outcome it would produce (15 or more = *Aprobado*, less = *Anulado*). The server computes the stored total and outcome.
- **Annulled**: annulment only records the outcome. The clinical record does not change and the student repeats the practical in another encounter.
- **Corrections**: a teacher can correct the current grade with every item and a mandatory reason (up to 4000 characters). Each correction is a new revision bound to the current one; if someone else corrected first, nothing is stored and the page asks to reload. Previous grades stay in the history with who graded and when.
- **Who sees what**: the student sees only the current grade (item scores, total, outcome and date) on the draft page. Teachers and administrators also see every revision with its reason.
- **Errors**: a report that is not closed, an existing grade, a stale revision, a missing permission or role, an invalid score or reason are each shown with their own message. Writes are sent once; an unconfirmed outcome asks to check the state before trying again.

## Not included

Attachments, patient electronic signatures and the administrative screen to enable subjects. Verification uses isolated synthetic fixtures; it does not prove a running backend or real data.
