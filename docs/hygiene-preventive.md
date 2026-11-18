# Hygiene and Preventive Dentistry II drafts

Hygiene and Preventive Dentistry II (*Higiene y Preventiva II*) is an Odontology form with its own backend API (`/hygiene-preventive-drafts`). Its clinical content is independent of Kinesiology and Oral Surgery I. This first delivery covers subject enabling, student drafts (medical history, FDI odontogram and caries indices), and read-only views for teachers and administrators.

Not in this delivery: plaque indices, the procedure log with teacher signature, informed consent, marital status and medical insurance.

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

Teachers reach `/teacher-clinical/hygiene-preventive/[id]?patient_id=…&subject_id=…&academic_group_id=…` from `/teacher-clinical` after choosing an assignment in an enabled context. Teachers never write: the page shows the draft read-only.

Administrators with `hygiene-preventive-drafts:read` list every draft at `/hygiene-preventive-admin` (paged with `limit` and `offset`) and open each one read-only at `/hygiene-preventive-admin/[id]`.

The read-only view shows the medical history answers and details, the odontogram chart with a text list of the recorded teeth and the count of unrecorded ones, and each loaded index with its components and server total (*No cargado* otherwise).
