# Initial kinesiology evaluation drafts

This slice provides a student-facing path from **My assigned patients** to an initial kinesiology evaluation draft:

- `/my-patients/[assignmentId]?limit=50&offset=0` revalidates one bounded page of current assignments and lists draft evaluations for that exact patient, subject, and academic group.
- `/kinesiology-evaluations/[id]?assignment_id=<assignmentId>&limit=50&offset=0` revalidates the selected assignment and evaluation identity before showing the draft.
- Creating a draft is an explicit POST. It creates a new empty draft each time; loading either route never creates one. A successful create redirects to the new evaluation, and successful edits use a post/redirect/get flow.

## Draft content and replacement behavior

Every clinical field is optional while a record is a draft. Supported content keys are `admission_date`, `admission_status`, `illness_history`, `medical_diagnosis`, `kinesiology_diagnosis`, `objectives`, `proposed_treatment`, `occupation`, `referring_physician`, `antecedents`, and `studies`. Antecedent choices preserve the distinction between `true`, `false`, explicit `null`, and fields not present in a partial antecedents object. Study rows can be omitted; an untouched blank row is omitted on save, while a partially filled row is rejected without silently dropping its text. Calendar dates use `YYYY-MM-DD`.

The browser submits named native controls. The server validates the submitted fields, creates the complete supported content object, and sends only `{ content }` to PATCH. Existing unsupported content keys fail closed rather than being discarded. Patient demographics, authorship, and audit fields are response-only. Successful PATCH replaces all content; it is not a partial merge.

## Access and lifecycle boundaries

The UI offers editing only as a presentation hint for the current author and a draft in a matching active assignment. Assignment and evaluation identities are checked again during each action. The backend remains the authority for current permissions, ownership, and transactional context checks. Local JWT claims are not authorization. No administrator bypass is introduced.

This slice does not implement consent, submission, teacher review, amendments, timeline/evolution operations, or other lifecycle mutations. Avoid simultaneous edits: the API has no version/ETag stale-write check, and the last successful full-content save wins.

The form's normal fields submit without JavaScript. JavaScript is used only to add/remove study rows and to suppress accidental rapid repeat clicks on explicit draft creation. Clinical text is not placed in query strings or local storage.
