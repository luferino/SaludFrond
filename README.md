# Astro Starter Kit: Basics

```sh
pnpm create astro@latest -- --template basics
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.svg
├── src
│   ├── assets
│   │   └── astro.svg
│   ├── components
│   │   └── Welcome.astro
│   ├── layouts
│   │   └── Layout.astro
│   └── pages
│       └── index.astro
└── package.json
```

To learn more about the folder structure of an Astro project, refer to [our guide on project structure](https://docs.astro.build/en/basics/project-structure/).

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `pnpm install`             | Installs dependencies                            |
| `pnpm dev`             | Starts local dev server at `localhost:4321`      |
| `pnpm build`           | Build your production site to `./dist/`          |
| `pnpm preview`         | Preview your build locally, before deploying     |
| `pnpm astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `pnpm astro -- --help` | Get help using the Astro CLI                     |

## Listing and search integration

- [Patient registry and Reception](docs/patient-listing-search.md): administrator registry and live-career-scoped Reception search, with bounded pagination.
- [Students and teachers](docs/person-listing-search.md): paginated name/code searches alongside existing registration forms.
- [Subjects and groups](docs/catalog-listing-search.md): name-only search retaining career and pagination context.
- [Assignments](docs/assignment-listing-search.md): scoped UUID filters, eligible-student name search, and validated list-state navigation; final independent verification is tracked in the feature task document.
- [Patient-context clinical filters](docs/contextual-clinical-filters.md): GET-only status/date filters for kinesiology lists, date filters for Oral Surgery lists, and an evaluation-id filter for evolutions.

These integrations target the local backend `feat/patient-list-search` worktree, not an assumed deployment. Patient-context clinical filters are implemented; final local packaging is pending. Local synthetic tests and compiled HTML checks do not establish live-backend, PostgreSQL, or real-browser behavior.

## Patient availability and assignment workflows

- [Administrative patient availability](docs/patient-availability.md): `/patient-availability`, exact-document lookup, linked academic context, availability history and withdrawal. Withdrawing availability does not end existing assignments or clinical access; enabling again creates a new period.
- [Teacher assignment creation](docs/teacher-assignment-creation.md): `/teacher-assignments`, named context-scoped selectors and explicit creation using the student's habilitation identifier. Backend authorization is authoritative; navigation permissions are presentation hints only.

- [Kinesiology evaluation submission](docs/kinesiology-submission.md): explicit student submission of the saved draft only (no implicit save, single POST, uncertain outcomes are never shown as success) and the **Fichas enviadas** list on `/my-patients/[assignmentId]`, and read-only version history on the student editor and the teacher detail page. Cross-context readers of an assignment see the authorized submitted snapshot read-only under **Fichas enviadas**; drafts from another origin are excluded from that list and never shown.
- [Teacher clinical access and paper consent](docs/teacher-clinical-access-consent.md): `/teacher-clinical`, contextual teacher read access to initial kinesiology records and their read-only version history; current-assignment discovery is not a historical catalog.
- [Oral Surgery I](docs/oral-surgery.md): subject discovery through `GET /oral-surgery-subjects/mine`, student drafts at `/oral-surgery-drafts/[id]` with version-checked full-content saves and the signed-paper consent declaration (not an electronic signature), and version-bound teacher authorization at `/teacher-clinical/oral-surgery/[id]`.

These screens do not add reassignment, queues, reservations, student claiming, registration, clinical state changes, or academic-link creation. Validation uses isolated synthetic fixtures; a successful local build does not establish live backend availability.

## Reception workflows

- [Reception](docs/reception.md): career-scoped `reception` accounts (`kinesiology` / `odontology`, one explicit grant per career). Admins create accounts and grant or revoke careers at `/reception-accounts` (by returned id or UUID; no account listing exists yet). `/reception/patients` lists the career's patients, links existing institutional patients only after explicit confirmation, registers new ones and edits contact data only. `/reception/availability` searches an enrolled patient by exact document, enables availability on the career's subject/group contexts, shows history and withdraws periods after explicit confirmation (the patient–career link is kept). No clinical, catalog, habilitation or assignment access.

Run public regression tests with `node --experimental-vm-modules --test tests/*.test.mjs`, then `pnpm astro check` and `pnpm build`.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
