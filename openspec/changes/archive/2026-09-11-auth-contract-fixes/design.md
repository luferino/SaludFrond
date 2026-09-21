# Design: Auth Contract Fixes

## Technical Approach

Implement the five in-scope fixes from the proposal against the SaludBack contract: single-point envelope error mapping in the shared API client, `email` added to the register payload, JWT-exp-derived session lifetime, `/auth/login` redirect targets, and sanitized post-login navigation. Follows established patterns (zero-JS forms + server actions, pods under `src/pods/auth/`, helpers in `src/shared/`) with no new dependencies and no backend changes. INFO findings from the proposal remain out of scope.

## Architecture Decisions

### D1: Envelope error mechanism (open question 1)

| Option | Tradeoff | Decision |
|---|---|---|
| Keep 401 short-circuit; actions match raw text | Perpetuates dead substring matching | Rejected |
| Parse envelope inside each action | Duplicates parsing per action | Rejected |
| `ApiError` in apiClient carries status/code/message; 401 keeps `clearSession` | One parse point, code-based mapping, session invalidation preserved | **Chosen** |

apiClient parses `{ error: { code, message } }` for every non-2xx response before throwing a new `ApiError` (`Error` subclass with `status`, optional `code`/`message`). HTTP 401 additionally clears the session (existing semantics) and throws `code: 'UNAUTHORIZED'`. Network failures stay plain `Error('Service unavailable')`, never `ApiError`. Actions switch on `error.code` — no text matching. Login maps `UNAUTHORIZED` → fixed "Credenciales inválidas" (spec mandates a mapped invalid-credentials error, not the backend message).

### D2: use:form directive (open question 2)

| Option | Tradeoff | Decision |
|---|---|---|
| Leave both forms as plain POST | Violates user-registration spec SHALL | Rejected |
| Add `use:form` to RegisterForm only | Spec-compliant, but auth forms diverge | Rejected |
| Add `use:form` to both forms | Spec-compliant; parity; documented Astro redirect pattern unchanged | **Chosen** |

`use:form` is spec-mandated for the register form and exists nowhere in the codebase today; applying it to LoginForm too keeps one wiring convention. Redirects stay server-side via the documented `getActionResult` + `Astro.redirect` pattern RegisterForm already uses (per Astro actions guide); zero-JS fallback is unchanged plain HTML POST.

### D3: Session lifetime from JWT exp

| Option | Tradeoff | Decision |
|---|---|---|
| Trust `{ token, exp }` response field | Backend returns only `{ token }` — dead field | Rejected |
| Decode exp via existing `decodeJwt` | Reuses helper; contract-accurate | **Chosen** |

`LoginResponse` becomes `{ token: string }`. `maxAge = payload.exp − floor(Date.now()/1000)`; fallback 7200s when decode fails, `exp` is missing, or `maxAge <= 0`.

### D4: returnTo sanitizer rules

| Option | Tradeoff | Decision |
|---|---|---|
| Current sanitizer (`startsWith('/')` + no `://`) | Lets `//evil.com` through — open-redirect gap | Rejected |
| Reject `//` prefix, `://` anywhere, non-`/` start | Covers protocol-relative and scheme redirects | **Chosen** |

Rules: missing/empty → `/`; must start with exactly one `/` (reject `//`); reject any `://`; otherwise return as-is (`/appointments?a=1` allowed).

### D5: zod minimalism for email

Register z-schema adds `email: z.string().min(1)` — presence only, mirroring username/password. Native `type="email"` provides the format hint; the backend remains validation authority. `z.string().email()` rejected: with JS disabled, malformed email must reach the backend and surface its `BAD_REQUEST` message (spec scenario), not a schema rejection.

## Error Envelope Mapping

| HTTP / Envelope code | Login | Register |
|---|---|---|
| 401 `UNAUTHORIZED` | "Credenciales inválidas" (fixed) | — |
| 4xx `BAD_REQUEST` | backend `message` | backend `message` |
| 409 `CONFLICT` | — | backend `message` |
| Envelope unparseable | `HTTP ${status}` | `HTTP ${status}` |
| Network failure | "Service unavailable" | "Service unavailable" |

## Data Flow

    Form (use:form) ──POST──▶ action handler ──apiFetch──▶ SaludBack
         ▲                                                 │
         │      { error: { code, message } } ◀─── or ────┴─ { token } / 2xx
         │
    getActionResult ──▶ success: Astro.redirect(returnTo | redirectTo)
                        error: <p class="error">{message}</p>

## File Changes

12 files in change scope — 11 Modify + 1 Create — estimated ±250 changed lines, well under the 400-line budget. Implementation also removed `src/pods/odonto/odonto.astro` (out-of-scope garbage cleanup, committed separately; not part of the auth-contract-fixes surface).

| File | Action | Change |
|---|---|---|
| `src/shared/apiClient.ts` | Modify | Add `ApiError`; parse envelope on non-2xx; keep 401 `clearSession`; network → plain Error |
| `src/pods/auth/actions/login.ts` | Modify | `LoginResponse {token}`; maxAge from `decodeJwt` + 7200 fallback; sanitizer rejects `//`; code-based error mapping |
| `src/pods/auth/actions/register.ts` | Modify | email in input type + body; CONFLICT/BAD_REQUEST → message; `redirectTo: '/auth/login'`; drop substring matching |
| `src/actions/index.ts` | Modify | register schema adds `email: z.string().min(1)` |
| `src/pods/auth/components/RegisterForm.astro` | Modify | email input (`type="email"`, required); add `use:form`; component-level redirect removed (moved to page) |
| `src/pods/auth/components/LoginForm.astro` | Modify | add `use:form`; component-level redirect removed (moved to page) |
| `src/pages/auth/login.astro` | Modify | page frontmatter: `Astro.getActionResult(actions.login)`; redirect to sanitized `returnTo` (use:form requires page-level redirect) |
| `src/pages/auth/register.astro` | Modify | page frontmatter: `Astro.getActionResult(actions.register)`; redirect to `redirectTo` ('/auth/login') |
| `src/env.d.ts` | Create | `use:form` JSX type augmentation required under TS strict (astro check 0 errors) |
| `src/middleware.ts` | Modify | PUBLIC_PATHS drops `/login`; redirect → `/auth/login?returnTo=` |
| `src/pages/index.astro` | Modify | redirect → `/auth/login?returnTo=/` |
| `src/pages/logout.astro` | Modify | redirect → `/auth/login` |

## Interfaces / Contracts

```ts
class ApiError extends Error { status: number; code?: string; }

// Backend error envelope (parsed only in apiClient):
//   { error: { code?: string; message?: string } }
// Action results:
//   register → { success: true, redirectTo: '/auth/login' }
//   login    → { success: true, returnTo: string } | { success: false, error: string }
```

## Manual Verification (no test runner installed)

1. **Register**: unique user succeeds → lands on `/auth/login`; duplicate shows backend message; JS-enabled browser blocks bad email format.
2. **Login**: valid creds with `?returnTo=/appointments` → navigates there; `?returnTo=//evil.com` → `/`; wrong password → "Credenciales inválidas"; backend stopped → "Service unavailable".
3. **Cookie**: after login DevTools shows `session` Max-Age ≈ 7200 (2h JWT exp).
4. **Redirects**: unauth request to `/appointments` → `/auth/login?returnTo=%2Fappointments`; logout and unauth index → `/auth/login`.
5. `pnpm astro check` and `pnpm build` pass.

## Migration / Rollout

No migration; frontend-only. Rollback via `git checkout` of the eleven modified files, plus deletion of the one new file (`src/env.d.ts`). The `src/pods/odonto/odonto.astro` deletion is separate out-of-scope cleanup — restore it via `git checkout` if its removal is not desired.

## Risks

- Low: a stale `/login` string could survive review — grep `['"]/login` after apply (5 dead references confirmed at design time).
- Low: `use:form` JS path changes submission mechanics — covered by manual tests 1–2 with JS enabled.
- Budget: negligible regression surface beyond the 12 small diffs (11 modify + 1 create).

## Open Questions

None — both spec-phase questions resolved (D1, D2).