# Proposal: auth-frontend

## Intent

Add self-service login, session management, and logout to SaludFront (Astro 7 frontend) so authenticated patients can access protected health-domain routes. Currently the frontend is static with no session handling, no API client, and no route protection.

## Scope

### In Scope
- Login form with server-side validation and backend call
- Persistent httpOnly session cookie (duration set by backend)
- Logout with cookie clearing
- Middleware-based route protection (all routes except `/login` require active session)
- Redirect-after-login preserving intended destination
- Server-side API client isolating backend auth contracts
- `@astrojs/check` + `typescript` devDeps for verification

### Out of Scope
- Password recovery (request + reset) — separate future change
- Role-based authorization (frontend only distinguishes logged-in vs not)
- UI framework integration (React/Vue/Svelte)
- Backend contract extraction (design phase must resolve exact endpoints/DTOs)

## Capabilities

### New Capabilities
- `auth`: Login, session persistence, logout, route protection, redirect-after-login

### Modified Capabilities
None

## Approach

Pure Astro server-side auth: `output: 'hybrid'` + `@astrojs/node` adapter. Login via `astro:actions` (`accept: 'form'`, zod validation). Session persisted in `httpOnly` + `sameSite: lax` cookie via `Astro.cookies`. Middleware in `src/middleware.ts` guards protected routes, redirects unauthenticated users to `/login?returnTo=...`. Forms use `use:form` progressive enhancement (zero JS). Auth pod at `src/pods/auth/` with thin route page at `src/pages/auth/login.astro`. Shared API client in `src/shared/apiClient.ts` isolates backend fetch contracts.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `astro.config.mjs` | Modified | Add `output: 'hybrid'` + `@astrojs/node` adapter |
| `package.json` | Modified | Add `@astrojs/node`, `@astrojs/check`, `typescript` devDeps |
| `src/middleware.ts` | New | Route guard: redirect unauthenticated from protected routes |
| `src/pages/auth/login.astro` | New | Thin login route page |
| `src/pods/auth/` | New | Auth pod: login form, server action, session helpers |
| `src/shared/apiClient.ts` | New | Server-side fetch wrapper to SaludBack |
| `src/shared/session.ts` | New | Cookie helpers (get/set/clear session) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Backend auth endpoint contracts unknown (paths, DTOs, token type) | High | Design phase must extract contracts; API client isolates shape |
| Deployment model change (static → SSR requires Node runtime) | Medium | Document deploy target requirement; may need hosting migration |
| `astro check` fails without added devDeps | Low | Include `@astrojs/check` + `typescript` in this change |
| Middleware guard bypassed on accidentally-static routes | Low | Verify each protected page is on-demand rendered in design phase |

## Rollback Plan

1. Revert `astro.config.mjs` to empty `defineConfig({})`
2. Remove `src/middleware.ts`, `src/pods/auth/`, `src/pages/auth/`, `src/shared/`
3. Remove added dependencies from `package.json`
4. Run `pnpm install` to restore clean state

## Dependencies

- SaludBack auth endpoints (login) must be available or mocked for development
- Node runtime for SSR deployment (current deploy target undefined)

## Success Criteria

- [ ] Login form submits to server action, validates credentials via backend
- [ ] Successful login sets persistent httpOnly cookie and redirects to `/`
- [ ] Failed login shows error message without page reload
- [ ] All routes except `/login` redirect to `/login?returnTo=...` when unauthenticated
- [ ] Logout clears cookie and redirects to `/login`
- [ ] `pnpm astro check` passes with added devDeps
- [ ] Zero client-side JavaScript for auth forms (progressive enhancement)