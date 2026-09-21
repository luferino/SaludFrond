# Proposal: user-registration

## Intent

Add self-service user registration so new patients can create an account from the frontend. Currently there is no way to register — users must be created directly in the backend or database. The backend already exposes `POST /auth/register` accepting `{ username, password }`.

## Scope

### In Scope
- Registration form component (username + password, zero-JS progressive enhancement)
- Server action calling `POST /auth/register` with error handling (409 duplicate, 400 validation)
- Registration page at `/auth/register` (SSR, follows login.astro pattern)
- Middleware: add `/auth/register` to `PUBLIC_PATHS`
- Success redirect to `/login` after registration

### Out of Scope
- Email field (backend doesn't accept it yet)
- Email verification flow
- Client-side validation beyond HTML required attributes
- Password strength requirements (backend enforces)
- Rate limiting or CAPTCHA on registration

## Capabilities

### New Capabilities
- `user-registration`: Registration form, server action, backend call, success/error states

### Modified Capabilities
None — the `auth` capability (from archived auth-frontend) is unchanged; registration is a new capability alongside it.

## Approach

Mirror the auth-frontend login pattern exactly:
1. **Action**: `src/pods/auth/actions/register.ts` — calls `POST /auth/register`, handles 201/409/400 responses
2. **Component**: `src/pods/auth/components/RegisterForm.astro` — form with username + password fields, uses `use:form` for zero-JS progressive enhancement
3. **Page**: `src/pages/auth/register.astro` — thin SSR page, mirrors `login.astro` layout
4. **Action definition**: Add register to `src/actions/index.ts` with Zod schema (`username: string, password: string`)
5. **Middleware**: Add `/auth/register` to `PUBLIC_PATHS` in `src/middleware.ts`

Follow existing conventions: inline `<style>` blocks, no CSS framework, no client-side JS, Zod validation in action only.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/pods/auth/actions/register.ts` | New | Registration handler (mirrors `login.ts`) |
| `src/pods/auth/components/RegisterForm.astro` | New | Registration form component |
| `src/pages/auth/register.astro` | New | Registration page route |
| `src/actions/index.ts` | Modified | Add register action definition with Zod schema |
| `src/middleware.ts` | Modified | Add `/auth/register` to `PUBLIC_PATHS` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Backend register endpoint not yet available for testing | Medium | Design phase documents exact contract; mock if needed |
| No client-side validation — poor UX on field errors | Low | Backend returns specific error messages; form displays them |
| Duplicate username race condition (rapid double-submit) | Low | Disable button after submit via no-JS redirect pattern; backend returns 409 |

## Rollback Plan

1. Remove `src/pods/auth/actions/register.ts`, `src/pods/auth/components/RegisterForm.astro`, `src/pages/auth/register.astro`
2. Remove register action definition from `src/actions/index.ts`
3. Remove `/auth/register` from `PUBLIC_PATHS` in `src/middleware.ts`
4. No dependency changes — clean revert

## Dependencies

- Backend `POST /auth/register` endpoint must accept `{ username, password }` — already confirmed available

## Success Criteria

- [ ] Registration form at `/auth/register` renders with username + password fields
- [ ] Submitting valid credentials calls backend, returns 201, redirects to `/login`
- [ ] Duplicate username shows 409 error message on form
- [ ] Missing/empty fields show 400 error message on form
- [ ] Unauthenticated users can access `/auth/register` (PUBLIC_PATHS)
- [ ] Zero client-side JavaScript (progressive enhancement via `use:form`)
- [ ] `pnpm astro check` passes
