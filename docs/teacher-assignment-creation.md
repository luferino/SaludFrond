# Teacher assignment creation

The authenticated `/teacher-assignments` page creates a direct patient assignment for a currently active teacher context. The context list is sourced only from `GET /patient-assignment-options/contexts`; selecting a context enables the named, paginated student-habilitation and available-patient selectors. Empty and denied selector responses are shown explicitly; the page does not substitute global catalogs.

The native POST action submits exactly `patient_id`, `student_habilitation_id`, `subject_id`, and `academic_group_id`. The student selector value is the habilitation UUID, not the student's profile UUID. Backend authorization remains authoritative. A destination-availability conflict and an existing active subject-assignment conflict have separate messages; neither is retried automatically. Reassignment, assignment lists, and clinical operations are outside this page's scope.

All selector pages use `limit` 1–100 and `offset` 0–10000, defaulting to 50/0. Navigation preserves each selector's page coordinates for the same context; choosing another context resets dependent selector pages. Successful native submissions redirect to a clean GET to prevent refresh resubmission. The page response is marked `Cache-Control: no-store`. Synthetic page/adapter/action tests cover request contracts; no live HTTP or database verification is implied.
