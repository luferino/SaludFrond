# Proposal: Auth Contract Fixes

## Intent

Align SaludFrond's login/logout/session/register flows with the SaludBack contract. Today register never sends `email` (backend hard-requires it, so the flow is 100% broken) and every auth redirect targets `/login`, which does not exist (only `/auth/login`, `/auth/register`) → 404 redirect loops.

## Scope

### In Scope
- **Register email**: add `email` to RegisterForm + z schema + action body; MINIMAL frontend format validation (`type="email"` / simple regex); backend remains validation authority.
- **Redirects**: fix all auth redirect targets from `/login` → `/auth/login` (middleware, index page, logout page, register success).
- **Session expiry**: login derives `maxAge = JWT exp − now` via existing `decodeJwt`; backend returns only `{token}` (2h expiry), so no custom duration.
- **Register errors**: map backend envelope `{ error: { code, message } }` with codes `BAD_REQUEST`/`CONFLICT`; replace dead substring matching ('409','duplicate','400','validation').
- **Post-login navigation**: on success navigate to sanitized `returnTo`; sanitizer also rejects protocol-relative URLs (`//...`).

### Out of Scope
- INFO findings: exp-only auth gate, Layout session indicator, login 400 mislabel — EXPLICITLY EXCLUDED.
- Patient registration flow, backend changes — none.

## Capabilities

### New Capabilities
- `auth`: login, session persistence, logout, route protection, returnTo navigation — never spec-formalized (archived auth-frontend left no spec; this change also fixes its behavior).

### Modified Capabilities
- `user-registration`: email required in schema/form/body; success redirect → `/auth/login`; backend error-code mapping.

## Approach

Mirror existing patterns: zero-JS Astro forms, server actions in `src/actions/index.ts`, handlers in `src/pods/auth/actions/`, existing `apiClient`/`session`/`decodeJwt` helpers. No new dependencies.

Backend contract: `POST /auth/login {username,password} → {token}`; `POST /auth/register {username,password,email}` (all required); errors `{ error: { code, message } }` with `BAD_REQUEST`/`CONFLICT`; no `/auth/logout` endpoint.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/actions/index.ts` | Modified | register z schema adds `email` |
| `src/pods/auth/actions/register.ts` | Modified | email in body, error-code mapping, redirect target |
| `src/pods/auth/components/RegisterForm.astro` | Modified | email input added |
| `src/pods/auth/actions/login.ts` | Modified | exp decoded from JWT, returnTo navigation, sanitizer |
| `src/pods/auth/components/LoginForm.astro` | Modified | navigates on success |
| `src/middleware.ts`, `src/pages/index.astro`, `src/pages/logout.astro` | Modified | `/login` → `/auth/login` redirects |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| JWT lacks readable `exp` → Max-Age still NaN | Low | Fallback to backend default 2h (7200s) |
| returnTo open-redirect regression | Low | Reject `//` and `://`; allow absolute paths only |

## Rollback Plan

`git checkout` the six modified files. Frontend-only change — no schema migration, no backend dependency, no data impact.

## Dependencies

- SaludBack already implements this contract (no backend changes required).

## Success Criteria

- [ ] Register submits `email` and succeeds end-to-end.
- [ ] All auth redirects resolve to existing pages (no `/login` references).
- [ ] Session cookie Max-Age = JWT `exp` − now (finite, positive).
- [ ] Duplicate/validation errors show backend `message`; dead substring matching gone.
- [ ] Login navigates to `returnTo`; `//evil.com` rejected to `/`.
- [ ] `pnpm astro check` passes.