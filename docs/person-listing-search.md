# Student and teacher registration lists

The existing `/students` and `/teachers` admin registration screens retain their
creation forms and add paginated lists from the corresponding backend selectors.
The list readers are local to each pod; neither the student-habilitation API nor
shared API modules are changed.

- Students search literal case-insensitive substrings in names, surnames, and
  student code. The displayed selector fields are name, surname, and code.
- Teachers search names and surnames and display only those fields.
- Both lists use the existing 50-item pagination defaults and shared pagination
  parser/navigation rules. There is no total-count inference.
- Search is trimmed, limited to 100 characters, and encoded with
  `URLSearchParams`; blank input omits `q`. Literal `%`, `_`, and backslash are
  sent as search text. Repeated, structured, and overlong `q` input is rejected
  before the backend request. Submitting a new search starts at offset zero;
  pagination links retain the current search.
- Backend errors render an error state rather than an empty-list state. Existing
  session, API error handling, access gates, and create-action schemas remain in
  place. The selector `id` remains a profile identifier and is not displayed or
  used as an account or habilitation identifier.

This documents the frontend behavior only; it does not claim deployed-backend,
production, or live database verification.
