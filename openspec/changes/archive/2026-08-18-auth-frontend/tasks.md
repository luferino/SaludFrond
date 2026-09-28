# Tasks: auth-frontend

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~280–320 (new + modified) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Project config + shared auth infrastructure | PR 1 | astro.config, deps, session, jwt, apiClient |
| 2 | Auth pod + login flow | PR 1 | actions, LoginForm, login page |
| 3 | Route guard + logout + layout update | PR 1 | middleware, logout route, index.astro |

All three units fit within a single PR (~300 lines). No chaining needed.

## Pre-Implementation Check

- [x] 0.1 **Resolved**: Token field is `token` (per design data flow `← 200: { token }`). Interface `LoginResponse { token, exp }`.
- [x] 0.2 **Resolved**: No `.env` existed. Created `.env.example` with `PUBLIC_API_URL` (Astro 7 uses `PUBLIC_` prefix, not `ASTRO_PUBLIC_`).

## Phase 1: Project Config + Shared Auth Infrastructure

- [x] 1.1 Add `@astrojs/node`, `@astrojs/check`, and `typescript@5.9.3` to `package.json` devDeps; run `pnpm install`.
- [x] 1.2 Modify `astro.config.mjs`: add `adapter: node({ mode: 'standalone' })`. **Deviation**: `output: 'hybrid'` was removed in Astro 7 — `static` is now the default and behaves the same way.
- [x] 1.3 Create `src/shared/session.ts`: export `getSession(cookies)`, `setSession(cookies, token, maxAgeSec)`, `clearSession(cookies)` using `Astro.cookies` with cookie name `session`, `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `secure: import.meta.env.PROD`.
- [x] 1.4 Create `src/shared/jwt.ts`: export `JwtPayload` interface, `decodeJwt(token)`, `isTokenValid(token)`. Uses `atob` for base64url decoding.
- [x] 1.5 Create `src/shared/apiClient.ts`: export `apiFetch<T>(path, opts)` — reads session cookie, constructs `Authorization: Bearer` header, calls `PUBLIC_API_URL + path`, catches 401 → clears session + throws. Handle fetch errors as `Service unavailable`.

## Phase 2: Auth Pod — Login Actions + Component

- [x] 2.1 Create `src/pods/auth/actions/login.ts`: handler function `handleLogin(input, context)`. **Deviation**: Action logic lives in pod handler; `defineAction` in `src/actions/index.ts` (Astro 7 requires actions in `src/actions/index.ts`).
- [x] 2.2 Create `src/pods/auth/actions/logout.ts`: handler function `handleLogout(input, context)`.
- [x] 2.3 Create `src/pods/auth/actions/index.ts`: barrel export `{ handleLogin, handleLogout }`.
- [x] 2.4 Create `src/pods/auth/components/LoginForm.astro`: form with `method="POST"` and `action={actions.login}`. **Deviation**: `use:form` removed in Astro 7 — native HTML form action works as zero-JS progressive enhancement.
- [x] 2.5 Create `src/pages/auth/login.astro`: `prerender = false`, imports Layout and LoginForm.
- [x] 2.6 Create `src/actions/index.ts`: Astro actions entry point with `defineAction` for login and logout.
- [x] 2.7 Create `.env.example` with `PUBLIC_API_URL=http://localhost:3000`.

## Phase 3: Route Guard + Logout + Layout Update

- [x] 3.1 Create `src/middleware.ts`: `onRequest` middleware. Skips `/login` and `/auth/login`. Reads session cookie → `decodeJwt()` → valid: continue, invalid: redirect to `/login?returnTo=...`.
- [x] 3.2 Create `src/pages/logout.astro`: `prerender = false`. **Deviation**: Directly calls `clearSession(Astro.cookies)` + `Astro.redirect('/login')` instead of using the form action (GET route doesn't need FormData).
- [x] 3.3 Modify `src/pages/index.astro`: `prerender = false`. Checks session via `getSession` + `isTokenValid`. Shows landing placeholder if authenticated, redirects to `/login` if not.
- [x] 3.4 Update `src/layouts/Layout.astro`: reads session cookie server-side, renders `<header>` with `<a href="/logout">Salir</a>` when logged in.
- [x] 3.5 Run `pnpm astro check` and `pnpm build` to verify type safety and successful build. **Result**: `astro check` passes (0 new errors; 4 pre-existing in odonto.astro). `pnpm build` succeeds.
