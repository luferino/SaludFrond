# Design: user-registration

## Technical Approach

Add registration by mirroring the auth-frontend login pattern exactly: zero-JS Astro form, server action with Zod validation, SSR page. Registration is a new file set inside `src/pods/auth/` — no new shared modules needed. The `apiClient.ts` throws on non-2xx, so the register handler catches those errors and maps HTTP status codes (409, 400) to user-facing messages. Two existing files are touched minimally: `src/actions/index.ts` (add action definition) and `src/middleware.ts` (add public path).

## Architecture Decisions

### Decision: Error handling in register action

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Use `apiFetch`, catch thrown errors, parse error body for status context | Reuses existing client; register must distinguish 409 vs 400 vs network | **Chosen** — consistent with login pattern; parse error message text |
| Call `fetch` directly in register handler | Full control over response; duplicates base URL / header logic | Rejected — DRY violation |
| Extend `apiFetch` to return structured errors | Cleanest long-term; changes shared module for one feature | Rejected — scope creep; can refactor later if more actions need this |

The `apiFetch` function throws `new Error(errorBody)` on non-2xx. The register handler wraps the call in try/catch and inspects the error message to distinguish 409 (duplicate) from 400 (validation) from network failure. Since the backend returns plain-text error bodies, string matching is sufficient.

### Decision: Register link placement

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Add to `Layout.astro` nav for all unauthenticated pages | Accessible everywhere; touches shared layout | **Chosen** — small conditional addition, improves discoverability |
| Add inline in `login.astro` only | Minimal change; only visible on login page | Rejected — user asked for Layout modification |
| Add to both | Redundant | Rejected |

### Decision: Action barrel export

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Add `handleRegister` to `src/pods/auth/actions/index.ts` | Follows existing barrel pattern; `src/actions/index.ts` imports from here | **Chosen** |
| Import directly from `register.ts` in `src/actions/index.ts` | Skips barrel; breaks convention | Rejected |

## Data Flow

```
RegisterForm.astro (use:form)
  → POST /_actions/register (server action)
    → handleRegister()
      → apiFetch('/auth/register', { method: 'POST', body: {username, password} })
        → SaludBack POST /auth/register
        ← 201: success → return { success: true }
        ← 409: throw Error("duplicate username msg") → catch → return { success: false, error: "..." }
        ← 400: throw Error("validation msg") → catch → return { success: false, error: "..." }
        ← network error → throw Error("Service unavailable") → catch → return generic error
    → On success: Astro.redirect('/login')
    → On error: re-render form with error message
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/pods/auth/actions/register.ts` | Create | Registration handler: calls backend, handles 201/409/400, returns result |
| `src/pods/auth/components/RegisterForm.astro` | Create | Form component: username + password, `use:form`, error display, styling matching LoginForm |
| `src/pages/auth/register.astro` | Create | SSR page: imports Layout + RegisterForm, mirrors login.astro |
| `src/actions/index.ts` | Modify | Add `register` action definition with Zod schema |
| `src/pods/auth/actions/index.ts` | Modify | Add `handleRegister` to barrel export |
| `src/middleware.ts` | Modify | Add `/auth/register` to `PUBLIC_PATHS` |
| `src/layouts/Layout.astro` | Modify | Add conditional register link in nav for unauthenticated users |

## Interfaces / Contracts

```typescript
// src/pods/auth/actions/register.ts
interface RegisterInput {
  username: string;
  password: string;
}

// Returns same shape as login: { success: boolean; error?: string }
// No cookie set — user must log in after registration
```

```typescript
// src/actions/index.ts — new action
register: defineAction({
  accept: 'form',
  input: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  handler: handleRegister,
}),
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Type check | All new files pass `astro check` | `pnpm astro check` |
| Unit | Register handler: success, 409, 400, network error paths | Manual code review (no test runner) |
| Integration | Registration flow: form → action → redirect to /login | Manual browser testing |
| Integration | Error display: 409 shows "username taken" message | Manual browser testing |
| E2E | Register → login → access protected page | Manual browser testing |

## Migration / Rollout

No migration required. Purely additive — new files + minimal edits to existing files.

**Rollback**: Remove the 3 new files, revert changes to the 4 modified files. Zero dependency changes.

## Open Questions

- [ ] None — all patterns confirmed from codebase reading and exploration artifact.
