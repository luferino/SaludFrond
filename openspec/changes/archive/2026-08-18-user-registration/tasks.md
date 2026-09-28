# Tasks: User Registration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~170 additions, ~5 modifications |
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
| 1 | Full registration feature | PR 1 | Single PR — all 7 files, well under budget |

## Phase 1: Foundation

- [x] 1.1 Add `handleRegister` barrel export to `src/pods/auth/actions/index.ts`
- [x] 1.2 Add `/auth/register` to `PUBLIC_PATHS` array in `src/middleware.ts`
- [x] 1.3 Add `register` action definition (Zod schema: username, password) to `src/actions/index.ts`, importing `handleRegister` from the barrel

## Phase 2: Core Implementation

- [x] 2.1 Create `src/pods/auth/actions/register.ts` — handler mirroring `login.ts` pattern: calls `apiFetch('/auth/register', ...)`, catches errors, maps 409→duplicate message, 400→validation message, network→generic error. Returns `{ success: boolean; error?: string }`
- [x] 2.2 Create `src/pods/auth/components/RegisterForm.astro` — form with username + password fields, `use:form`, error display, inline styles matching `LoginForm.astro`. Button text: "Registrarse"

## Phase 3: Integration

- [x] 3.1 Create `src/pages/auth/register.astro` — SSR page (`prerender = false`), imports Layout + RegisterForm, mirrors `login.astro` structure. Heading: "Registro"
- [x] 3.2 Add conditional register link in `src/layouts/Layout.astro` nav for unauthenticated users (inside `{!isLoggedIn && ...}` block), linking to `/auth/register`
