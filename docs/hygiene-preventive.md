# Hygiene and Preventive Dentistry II drafts

Hygiene and Preventive Dentistry II (*Higiene y Preventiva II*) is an Odontology form with its own backend API (`/hygiene-preventive-drafts`). Its clinical content is independent of Kinesiology and Oral Surgery I. It covers subject enabling, student drafts (medical history, FDI odontogram, caries and plaque indices), paper-consent declarations, a procedure log and teacher approval. Administrators consult these records read-only.

Not delivered: marital status and medical insurance.

## Enabling subjects (administrator)

`/hygiene-preventive-subjects` lists the subjects enabled for the form (`hygiene-preventive-subjects:read`) and, with `hygiene-preventive-subjects:write`, offers a form to enable one more:

- The select lists subjects that are not enabled yet. The subjects API does not expose the career, so non-Odontology subjects are listed too; the backend rejects them with *La asignatura no existe o no es de Odontología.*
- Enabling cannot be undone through the system. The form requires the checkbox *Entiendo que la habilitación no se puede deshacer desde el sistema.* and sends exactly one POST.
- A subject that was already enabled shows *La asignatura ya estaba habilitada.* An unconfirmed outcome (network or server error) asks to reload the list before trying again.

A subject's name never enables the form, and no subject ID is hardcoded.

## Choosing the form for an assignment

`/my-patients/[assignmentId]` (student) and `/teacher-clinical` (teacher) call `GET /hygiene-preventive-subjects/mine` once, without query parameters, when the session carries `hygiene-preventive-drafts:read`, in addition to the Oral Surgery I discovery described in [Oral Surgery I](oral-surgery.md).

| Discovery result | What the page shows |
| --- | --- |
| Pair enabled for Hygiene and Preventive II only | That form only: its drafts and, for students, **Crear nuevo borrador de Higiene y Preventiva II**. |
| Pair enabled for both Odontology forms | Two sections, one below the other: Cirugía Oral I first, then Higiene y Preventiva II, each with its own create button and list. |
| Pair enabled for Oral Surgery I only | The Oral Surgery I view, unchanged. |
| Pair enabled for neither, or no grant in the session | The Kinesiology view, unchanged. |
| 403 from hygiene discovery | The hygiene form is not shown. |
| 401 | Redirect to login. |
| Any other discovery failure or a malformed response | An alert and no clinical actions at all, to avoid creating the wrong form. |

Each list shows at most the 50 most recent drafts of the context and says so when the limit is reached. The hygiene list has no date filter: the backend list accepts only the context and paging.

## Student draft editor

`/hygiene-preventive-drafts/[id]?assignment_id=<id>&limit=50&offset=0` revalidates the active assignment and requires the draft's patient, origin subject and origin group to match it. Editing is offered only to the author with a student role and the `hygiene-preventive-drafts:write` grant; these session claims are presentation hints and the backend rechecks every write.

- **Create**: each click on the create button sends one POST and opens a new clinical encounter. Existing encounters are resumed from the list, never recreated.
- **Medical history**: fourteen Yes/No questions with *Sin responder*, *Sí* and *No*, each followed by an optional *Detalle* text, plus *Médico tratante* and *Observaciones*. Texts accept up to 4000 characters.
- **Odontogram**: a chart of the 52 FDI teeth (permanent 11–48 and deciduous 51–85). Choosing a tooth opens a panel with its state (*Sin registrar*, *Presente*, *Ausente*, *A extraer*) and a table of its five faces (oclusal/incisal, mesial, distal, vestibular, lingual/palatina) with *Caries* and *Obturada* checkboxes; both together mark a secondary caries. A tooth that was never recorded is *Sin registrar*, not healthy. An absent tooth cannot have marked faces. Without JavaScript every tooth is shown as a plain list of controls and the form still saves; marked faces on a tooth without a state are rejected with a message instead of being dropped.
- **Indices**: ceo-d (c, e, o; total up to 20), CPO-D (c, p, o; up to 32) and CPO of first molars (c, p, o; up to 4). Fill in all three values of an index or leave them all empty. The total is computed by the server and shown read-only; the frontend never sends it.
- **Save**: the form replaces the whole content and sends the `expected_version` the student loaded. Before the PATCH, the action reads the current draft; empty controls keep the stored representation of an unanswered question (absent stays absent, `null` stays `null`), and clearing an answer stores `null`.
- **Stale version**: if another tab or person saved first, nothing is stored. The page shows the current version in the form and the unsaved values separately for copying; it never resubmits them automatically.
- **Unknown outcome**: a network failure or server error after the PATCH is reported as unconfirmed, never as saved.

## Teacher and administrator views

Teachers reach `/teacher-clinical/hygiene-preventive/[id]?patient_id=…&subject_id=…&academic_group_id=…` from `/teacher-clinical` after choosing an assignment in an enabled context. Teachers cannot edit draft content, consent declarations or procedure text. With `hygiene-preventive-drafts:approve`, they can approve pending procedure entries in their active origin subject/group. Approval requires explicit confirmation and is final: the student can no longer edit or delete the entry. Teachers logged in before migration 059 must sign in again to obtain the new permission.

Administrators with `hygiene-preventive-drafts:read` list every draft at `/hygiene-preventive-admin` (paged with `limit` and `offset`) and open each one read-only at `/hygiene-preventive-admin/[id]`.

The read-only view shows medical history, the odontogram and recorded teeth, caries indices and server totals, plaque results, consent history and the procedure log. Administrators never approve procedures.

## Plaque indices

The student editor includes **Índices de placa**:

- **Löe-Silness**: teeth 16, 21, 24, 36, 41 and 44; distal, vestibular, mesial and lingual/palatal sites, graded 0–3. *No presente* excludes the site from the calculation; zero is a recorded grade.
- **O'Leary**: mark each evaluated tooth, then its stained surfaces (mesial, distal, vestibular, lingual). An evaluated tooth with no stained surface still contributes four surfaces. A stained surface without *Evaluada* is rejected instead of silently discarded.
- Results (average, percentage and category) are calculated by the server and shown read-only. Saving strips all computed plaque results and caries-index totals. Unchanged plaque controls preserve recorded teeth, including empty Löe-Silness teeth. Clearing a loaded section stores `null`.

## Paper consent

After the draft form, **Consentimiento informado en papel** records a declaration that a signed paper exists; it is not an electronic signature or an upload. Only the draft author declares it. Choose *Paciente* or *Madre, padre o tutor*. For the latter, supply a name (up to 200 characters) and a document of 4–8 digits. For a patient signer, leave both fields empty: the backend copies the patient identity. The backend requires a parent signer for patients under 18 on the UTC declaration date.

Declarations are append-only. To correct one, declare again; the history remains visible and identifies the current declaration. Declaration does not change the draft version. A read failure hides the declaration form; an uncertain submission requires a reload and a history check before trying again.

## Procedure log

The author records a date (not after today in UTC) and a non-blank description (up to 1000 characters). At least one consent declaration is required to add an entry. Entries appear in creation order with their author and approval status.

Pending entries can be edited or deleted by their author; deletion asks for confirmation. Each change carries the entry's `expected_version`, independent of the draft version. A stale entry must be reloaded, and approved entries cannot be changed. Approval identifies the teacher and server timestamp.

Consent and procedure submissions never retry automatically. An uncertain create asks to inspect the history/list before trying again, because retrying could create another record. With JavaScript, unsaved draft edits disable consent and procedure submission until the draft is saved. Without JavaScript, the backend still enforces permissions, consent and entry versions.
