# Design: auth-frontend

## Technical Approach

Pure Astro server-side authentication. Login via `astro:actions` with `accept: 'form'` for zero-JS progressive enhancement. JWT persisted in httpOnly cookie; middleware reads cookie to guard protected routes. Shared API client adds `Authorization: Bearer` header when making server-side requests to SaludBack. The frontend NEVER sends cookies to the backend — it acts as a trusted intermediary.

Switches from static output to `output: 'hybrid'` with `@astrojs/node` adapter to enable server-side rendering and middleware.

## Architecture Decisions

### Decision: SSR output mode

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `output: 'hybrid'` + `@astrojs/node` | Requires Node runtime for deploy; most pages become SSR | **Chosen** — needed for middleware, actions, cookies |
| Static + client-side JS | No deploy change; but breaks zero-JS constraint, complex state management | Rejected |
| `output: 'server'` | Forces all pages to SSR; kills static optimization for non-auth pages | Rejected — hybrid lets non-auth pages stay static if desired |

### Decision: Cookie vs localStorage for JWT

| Option | Tradeoff | Decision |
|--------|----------|----------|
| httpOnly cookie | Cannot be read by JS (XSS-safe); requires SSR/middleware to read | **Chosen** — backend contract expects Bearer header, cookie is the transport only |
| localStorage | JS-accessible; vulnerable to XSS; cannot be read by middleware | Rejected |
| Memory only | Lost on refresh; poor UX for persistent session | Rejected |

### Decision: JWT parse strategy in middleware

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Decode + expiry check (no signature verify) | Fast; sufficient for routing decisions; backend is real verifier | **Chosen** — frontend never trusts JWT claims for authorization |
| Full signature verify with `jose` | Adds dependency; redundant since backend verifies | Rejected |
| Forward to backend on every request | Adds latency; defeats purpose of JWT | Rejected |

### Decision: Validation library

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Zod | Astro 7 ships with `astro:actions` zod integration; familiar pattern | **Chosen** |
| Valibot | Smaller bundle; but no Astro integration | Rejected |

## Data Flow

```
Login Form (use:form)
  → POST /_actions/login (server action)
    → API client → POST /auth/login {username, password}
    ← 200: { token } or 401: error
    → Set cookie: session=<jwt>; httpOnly; sameSite=lax; path=/
    → Redirect to returnTo || /

Subsequent Request
  → src/middleware.ts reads cookie "session"
    → Decode JWT, check exp
    → If valid: continue to page
    → If missing/expired: redirect /login?returnTo=<path>

Page Load (any protected page)
  → Layout.astro or page uses API client
    → API client reads cookie, adds Authorization: Bearer header
    → GET/POST to SaludBack
    ← If 401 from backend: clear cookie, redirect /login
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `astro.config.mjs` | Modify | Add `output: 'hybrid'`, `@astrojs/node` adapter |
| `package.json` | Modify | Add `@astrojs/node`, `@astrojs/check`, `typescript` devDeps |
| `src/middleware.ts` | Create | Route guard — read cookie, decode JWT, redirect if invalid |
| `src/pods/auth/actions/login.ts` | Create | Astro action: validate with zod, call API, set cookie, return result |
| `src/pods/auth/actions/logout.ts` | Create | Astro action: clear cookie, redirect |
| `src/pods/auth/actions/index.ts` | Create | Action barrel export |
| `src/pods/auth/components/LoginForm.astro` | Create | Form with `use:form` progressive enhancement |
| `src/shared/apiClient.ts` | Create | Fetch wrapper adding Bearer header from cookie; handles 401 |
| `src/shared/session.ts` | Create | Cookie helpers: getSession, setSession, clearSession |
| `src/shared/jwt.ts` | Create | Base64 decode + expiry check (no signature verify) |
| `src/pages/auth/login.astro` | Create | Thin route page, imports LoginForm |
| `src/pages/logout.astro` | Create | Thin route page that triggers logout action on load |

## Interfaces / Contracts

```typescript
// src/shared/session.ts
const SESSION_COOKIE = 'session';

function getSession(cookies: AstroCookies): string | null;
function setSession(cookies: AstroCookies, token: string, maxAgeSec: number): void;
function clearSession(cookies: AstroCookies): void;

// src/shared/jwt.ts
interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  exp: number;
  iat: number;
}

function decodeJwt(token: string): JwtPayload | null;
function isTokenValid(token: string): boolean;

// src/shared/apiClient.ts
interface ApiClientOptions {
  method?: string;
  body?: unknown;
  cookie?: string;  // raw cookie header value (session=jwt)
}

async function apiFetch<T>(path: string, opts?: ApiClientOptions): Promise<T>;

// src/pods/auth/actions/login.ts — action input/output
const loginInputSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  returnTo: z.string().optional(),
});
// Returns { success: boolean; error?: string; returnTo?: string }
```

## Cookie Specification

| Property | Value | Rationale |
|----------|-------|-----------|
| Name | `session` | Simple, non-identifying |
| Path | `/` | Available on all routes |
| httpOnly | `true` | XSS-safe |
| secure | `import.meta.env.PROD` | HTTPS in production, HTTP in dev |
| sameSite | `lax` | Standard protection; allows same-site navigation |
| maxAge | From JWT `exp` - `iat` | Duration set by backend (default 2h); frontend does NOT hardcode |

## Error Handling and Edge Cases

### JWT expired while user is active
Middleware detects expired token on next request → redirect to `/login?returnTo=<current-path>`. No in-page detection needed; the redirect is the UX.

### Backend returns 401 mid-session (token revoked server-side)
`apiClient.ts` catches 401 response → calls `clearSession()` → redirects to `/login`. Prevents user seeing stale "authorized" state.

### Backend unreachable
Login action catches fetch error → returns `{ success: false, error: 'Service unavailable' }` → LoginForm displays error message. No cookie set, no redirect.

### returnTo open redirect protection
`returnTo` parameter MUST be validated:
- Accept only paths starting with `/` (same-origin)
- Reject absolute URLs (`http://`, `https://`, `//`)
- Reject paths containing `://`
- Fallback to `/` if invalid

### Cookie set but redirect fails
Login action uses `Astro.redirect()` after setting cookie. If redirect fails (network), the cookie is still set — user lands on login page but is authenticated, next navigation works. No data loss.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Type check | All new files pass `astro check` | `pnpm astro check` (added devDep) |
| Unit | JWT decode, expiry check, returnTo validation | Manual verification in tasks phase (no test runner) |
| Integration | Login flow: form → action → cookie → redirect | Manual browser testing |
| Integration | Route guard: unauthenticated access → redirect | Manual browser testing |
| E2E | Full login → navigate protected page → logout cycle | Manual browser testing |

No automated test runner (strict_tdd disabled per config). Verification via `pnpm build` + `pnpm astro check` + manual flow testing.

## Migration / Rollout

No data migration required. The change is purely additive — adds auth layer to an existing static frontend.

**Deploy requirement**: Hosting must support Node runtime (`@astrojs/node` adapter). If currently deployed to a static host (e.g., Cloudflare Pages, Netlify static), deployment config must change.

**Rollback**: Revert `astro.config.mjs`, remove new files, remove added deps from `package.json`, run `pnpm install`.

## Open Questions

- [ ] Does the login response body include `{ token: string }` or `{ accessToken: string }`? The backend contract says "JWT access token" — exact field name needed for API client.
- [ ] Is there a `.env.example` or existing env convention for `ASTRO_PUBLIC_API_URL`? Need to confirm naming.
- [ ] Current deploy target — is it static hosting that would need migration to Node-capable?
