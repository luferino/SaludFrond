# Contextual clinical list filters

Clinical filters are GET-only controls in the selected patient/context. They do not create a global inbox or alter mutation forms. Assignment filters, selected assignment, and page coordinates remain separate and are retained when applying filters.

Kinesiology evaluation lists accept visible status (`draft`, `submitted`, `validated`) and inclusive UTC `date_from` / `date_to`. Evolution lists use the same filters and additionally accept a positive BIGINT decimal-string `evaluation_id`. Dates are real `YYYY-MM-DD` values in years 0001–9999; year 0000, impossible dates, duplicate/structured values, and reversed ranges are rejected before clinical reads. Backend projection remains authoritative for visible status and timestamps.

Student initial-evaluation drafts remain origin-scoped. Submitted/validated snapshots continue to use the existing patient-only cross-origin reader, which excludes drafts; no origin filter is added to that request. Evolutions are shown read-only only when the existing `kinesiology-evolutions:read` grant is present. An evolution read failure (other than 401, which redirects to login as before) shows an evolution-specific error inside the evolutions section and keeps the evaluation lists rendered. An invalid clinical or evolution filter is the only failure shown as a filter alert: it is caught before any clinical read, shows the parser's own message once, and keeps the filter form editable, while any other load failure shows the generic safe message without the filter form.

Oral Surgery lists accept only date bounds and always use the selected patient/context in these screens. Discovery, forbidden, and failure behavior remains unchanged. Omitted filters preserve the previous adapter requests and ordering.

Validation is local synthetic frontend evidence only. It does not establish live backend, database, or production behavior.
