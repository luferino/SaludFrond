# Patient listing and search (T1)

The existing `/patients` page keeps its administrator-only gate and patient-creation form, and adds a registry backed by `GET /patients`. The frontend accepts only the paginated envelope `{ items, limit, offset }` (no `total`) and the canonical patient projection with exactly nine fields: `id`, `documento`, `nombres`, `apellidos`, `fecha_nacimiento`, `email`, `celular`, `sexo`, and `direccion`. It validates the response shape/types without imposing a numeric-only document rule, then displays names and document only.

Reception remains on `/reception/patients`. Career grants are loaded fresh before a patient-list request; no grant means no list request. Search and paging preserve the currently selected career. The Reception API defaults to limit 100; the admin registry defaults to 50. Both retain the existing pagination bounds and URL query conventions. A filtered or non-first-page empty Reception result is described as no matches for those filters, not as an empty career registry.

Both forms use literal substring search. Search input is trimmed, restricted to 100 characters, and duplicate, structured, or overlong values are rejected. URLSearchParams preserves `%`, `_`, and backslash as literal query values. Existing patient creation and Reception document match/reuse/contact actions are unchanged.

## Proof and limits

Run the focused suites with:

```sh
node --experimental-vm-modules --test tests/patient-listing-search.test.mjs tests/patients.test.mjs tests/reception-patients.test.mjs
```

The tests exercise the admin adapter against the canonical nine-field shape and compile/render both Astro pages with synthetic responses, including search/pager HTML, 401 redirect, 403/500 error states, and career-scoped empty-result copy. They also retain create/match/reuse/contact regressions. `pnpm astro check` and `git diff --check` provide static and whitespace checks.

All proof is local and synthetic. No live backend, database, PostgreSQL, production deployment, or real patient data is used or established by these tests. Reception isolation still depends on the backend's fresh grant check; the frontend check is not authorization proof.
