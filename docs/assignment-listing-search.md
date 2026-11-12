# Assignment filters and student search

Assignment lists keep their current authorization and active-assignment scope. Filters narrow the existing result set; they do not grant access, add history, or change assignment creation powers.

## Listing and selection

- `/my-patients` and `/teacher-clinical` accept optional UUID filters `patient_id`, `student_id`, `subject_id`, and `academic_group_id`. Supplied filters combine with AND before backend pagination. Blank optional fields are omitted; malformed, repeated, or structured values are rejected.
- The eligible-student selector on `/teacher-assignments` supports `q` for names and surnames within the selected subject/group. Search trims surrounding whitespace and accepts at most 100 characters. `%`, `_`, and backslash are literal text. Empty search omits the filter; duplicate or structured search parameters are invalid.
- A new student search resets the student offset, while retaining the independent context and patient pagination coordinates. Pagination retains the active search.
- `student_id` identifies a student profile. The creation form still submits `student_habilitation_id`, and the backend mutation body retains its existing four fields. Search state is not a mutation field.

## Detail and action navigation

Downstream clinical pages carry list filters and pagination in validated `list_*` fields. These navigation coordinates are separate from the selected record's clinical-origin keys. They must not replace the patient/origin context, bypass discovery, or trigger an unfiltered fallback when an assignment disappears.

Frontend action schemas accept explicit optional navigation fields while retaining their other validation. Actions use validated coordinates for assignment lookup and return navigation, not as backend mutation payload fields. Existing workflows without list state remain covered by regression tests.

## Verification limits

The final local regression run passed 572 tests, Astro checking (zero errors and warnings; 25 hints), build, and whitespace checks. Coverage includes synthetic API requests and compiled Astro HTML; it does not establish live backend, database, PostgreSQL, or real-browser behavior. Independent authorization/compatibility verification, including the repaired seven-form producer/schema/handler flow, and local commit evidence are tracked separately in `odd/tasks/frontend-listings-search.md`. Patient-context clinical status/date filters (T5) are a separate, not-yet-implemented task.
