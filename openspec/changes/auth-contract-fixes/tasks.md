# Tasks: Auth Contract Fixes

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~200 (range 150–250) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Envelope errors + JWT-exp cookie + returnTo sanitizer (apiClient, login action) | PR 1 | Shared foundation first |
| 2 | Register email: schema + action (actions/index, register.ts) | PR 1 | Depends on unit 1 envelope |
| 3 | Forms + redirects (RegisterForm, LoginForm, middleware, index, logout) | PR 1 | Depends on units 1–2; guard last |
| 4 | Verification (grep, astro check/build, smoke tests) | PR 1 | Final gate |

## Phase 1: Foundation — Envelope Errors & Auth Actions

- [x] 1.1 `src/shared/apiClient.ts`: add `ApiError` (Error subclass: `status`, optional `code`/`message`); parse `{ error: { code, message } }` on every non-2xx; keep 401 `clearSession` + throw `code: 'UNAUTHORIZED'`; network failures throw plain `Error('Service unavailable')`.
- [ ] 1.2 `src/actions/index.ts`: register schema adds `email: z.string().min(1)` (presence only; native `type="email"` is the format hint).
- [x] 1.3 `src/pods/auth/actions/login.ts`: narrow `LoginResponse` to `{ token }`; cookie `maxAge` from `decodeJwt` `exp` − now, fallback 7200s; sanitizer rejects `//` prefix and `://`; map errors by code (`UNAUTHORIZED` → "Credenciales inválidas", `BAD_REQUEST` → message, fallback `HTTP ${status}`); drop substring matching.
- [ ] 1.4 `src/pods/auth/actions/register.ts`: add email to input type and POST body; map `CONFLICT`/`BAD_REQUEST` → backend message, fallback `HTTP ${status}`; success `redirectTo: '/auth/login'`; drop substring matching.

## Phase 2: Forms

- [ ] 2.1 `src/pods/auth/components/RegisterForm.astro`: add email input (`type="email"`, required); add `use:form` directive.
- [ ] 2.2 `src/pods/auth/components/LoginForm.astro`: add `use:form`; on success `Astro.redirect(result.data.returnTo)`.

## Phase 3: Redirects & Guard

- [ ] 3.1 `src/middleware.ts`: drop `/login` from PUBLIC_PATHS; redirect to `/auth/login?returnTo=<encoded pathname>`.
- [ ] 3.2 `src/pages/index.astro`: redirect to `/auth/login?returnTo=/`.
- [ ] 3.3 `src/pages/logout.astro`: redirect to `/auth/login`.

## Phase 4: Verification & Cleanup

- [ ] 4.1 Grep `['"]/login` across `src/` — zero remaining matches (5 dead refs at design time).
- [ ] 4.2 Run `pnpm astro check` and `pnpm build` — both pass.
- [ ] 4.3 Manual smoke tests: login success (−/+ `returnTo` variants incl. `//evil.com` → `/`); login wrong password (401 → "Credenciales inválidas"); backend down ("Service unavailable"); register success → `/auth/login`; register duplicate (CONFLICT message); register invalid email (BAD_REQUEST message); JS-enabled browser blocks malformed email; cookie Max-Age ≈ 7200; unauth protected route → `/auth/login?returnTo=%2F...`; logout → `/auth/login`.