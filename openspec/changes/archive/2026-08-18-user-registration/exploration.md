# Exploration: user-registration

## Current State

- Astro 7 (`^7.0.6`) + TypeScript strict, pnpm, Node >= 22.12.0, `@astrojs/node` adapter (standalone mode)
- Pod-based architecture: `src/pods/{feature}/` with `actions/` (server-side handlers) and `components/` (Astro components)
- Auth frontend fully implemented (auth-frontend change archived): login, session, logout, middleware route guard
- Backend has `POST /auth/register` endpoint: accepts `{ username, password }`, creates `estudiante` user, returns 201 (success), 409 (duplicate username), 400 (missing/empty fields)
- No CSS framework — inline `<style>` blocks in components
- No test runner configured

## Established Patterns (from auth-frontend)

| Pattern | Location | Details |
|---------|----------|---------|
| Pod structure | `src/pods/{feature}/components/` + `src/pods/{feature}/actions/` | Feature isolation with sub-directories |
| Pages (SSR) | `src/pages/{feature}/{page}.astro` | `export const prerender = false;` + Layout + component import |
| Actions | `src/actions/index.ts` | Central registry using `defineAction` + Zod validation + `accept: 'form'` |
| Server handler | `src/pods/{feature}/actions/{handler}.ts` | `(input, context: { cookies: AstroCookies })` signature |
| Component | `src/pods/{feature}/components/{Form}.astro` | HTML `<form>` with `action={actions.xxx}`, inline styles, error display |
| API client | `src/shared/apiClient.ts` | `apiFetch<T>(path, { method, body, cookies })` — auto-injects Bearer token |
| Session | `src/shared/session.ts` | `getSession`, `setSession`, `clearSession` — httpOnly cookie |
| JWT | `src/shared/jwt.ts` | `decodeJwt`, `isTokenValid` |
| Middleware | `src/middleware.ts` | `PUBLIC_PATHS` whitelist for unauthenticated routes |
| Layout | `src/layouts/Layout.astro` | HTML shell, conditional nav based on session |

## Affected Areas

- `src/pods/auth/actions/` — NEW: `register.ts` handler
- `src/actions/index.ts` — MODIFIED: add `register` action definition with Zod schema
- `src/middleware.ts` — MODIFIED: add `/auth/register` to PUBLIC_PATHS
- `src/pages/auth/register.astro` — NEW: registration page (mirrors `login.astro` pattern)
- `src/pods/auth/components/RegisterForm.astro` — NEW: registration form component

## Approaches

### 1. Registration in auth pod (`src/pods/auth/`)
- **Pros**: Follows existing pattern exactly, URL aligns with backend (`/auth/register`), minimal change footprint, registration is an auth concern
- **Cons**: Auth pod grows to 4 flows (login, logout, register, forgot-password if added later)
- **Effort**: Low

### 2. Registration in usuario pod (`src/pods/usuario/`)
- **Pros**: Screaming architecture — clear domain separation, `usuario` pod already exists (empty)
- **Cons**: Cross-pod dependency for page routing, slightly more indirection for a single form
- **Effort**: Low

## Recommendation

**Approach 1: Keep registration in auth pod**. Registration is fundamentally an auth concern (credential creation, not user profile management). The backend endpoint is `/auth/register`. The `usuario` pod is better reserved for future user profile/management features.

## Risks

- **Backend email field mismatch**: Backend spec only accepts `username` + `password`. If email is wanted in the form, it's either UI-only or backend needs extending. **Clarification needed from user.**
- **Middleware scope**: Need to add register route to PUBLIC_PATHS for unauthenticated access.
- **No form validation library**: Current pattern uses Zod in actions only; no client-side validation. Manual validation or a library needed for field-level feedback.
- **No test runner**: Cannot write automated tests for this change.

## Ready for Proposal

Yes — all patterns clear, reference implementation (auth-frontend) fully available, backend endpoint spec known. Only clarification needed: whether email is backend-received or UI-only.
