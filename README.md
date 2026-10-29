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

## Patient availability and assignment workflows

- [Administrative patient availability](docs/patient-availability.md): `/patient-availability`, exact-document lookup, linked academic context, availability history and withdrawal. Withdrawing availability does not end existing assignments or clinical access; enabling again creates a new period.
- [Teacher assignment creation](docs/teacher-assignment-creation.md): `/teacher-assignments`, named context-scoped selectors and explicit creation using the student's habilitation identifier. Backend authorization is authoritative; navigation permissions are presentation hints only.

- [Teacher clinical access](docs/teacher-clinical-access-consent.md): `/teacher-clinical`, contextual teacher read access to initial kinesiology records; current-assignment discovery is not a historical catalog.

These screens do not add reassignment, queues, reservations, student claiming, registration, clinical state changes, or academic-link creation. Validation uses isolated synthetic fixtures; a successful local build does not establish live backend availability.

Run public regression tests with `node --experimental-vm-modules --test tests/*.test.mjs`, then `pnpm astro check` and `pnpm build`.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
