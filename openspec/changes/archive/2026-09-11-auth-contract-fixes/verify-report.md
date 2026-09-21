# Verify Report: Auth Contract Fixes

**Change**: auth-contract-fixes
**Version**: spec v1 (auth + user-registration delta)
**Report history**: v1 (initial PASS, below) · v2 (post-fix re-verification, bottom section — supersedes v1's redirect-related evidence rows only)
**Mode**: Standard (Strict TDD inactive — no test runner installed; manual + HTTP smoke verification sanctioned by design.md §Manual Verification)

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 27 (11 core + 15 smoke sub-items) |
| Tasks complete | 27 |
| Tasks incomplete | 0 |

## Build & Tests Execution

**Build**: ✅ Passed
```text
> astro build
[build] output: "static" / mode: "server" / adapter: @astrojs/node
[build] ✓ Completed in 4.20s.
[build] Server built in 7.05s
[build] Complete!
```

**Type-check**: ✅ Passed
```text
> astro check
Result (22 files):
- 0 errors
- 0 warnings
- 0 hints
```

**Tests**: N/A — no test runner in project (confirmed config; `strict_tdd: false` cached at sdd-init #82).
**Coverage**: ➖ Not available.

Runtime evidence substitutes (project-sanctioned manual verification):
- HTTP smoke items 1–6 (forms render 200, `/` → 302 `/auth/login?returnTo=%2F`, `/appointments` → 302 `returnTo=%2Fappointments`, hidden returnTo propagation, `/logout` → 302): ✅ [x] tasks.md
- Backend-direct contract smoke items 8/10/11/12 (login 401 UNAUTHORIZED, register 201, duplicate 409 CONFLICT, invalid email BAD_REQUEST) against SaludBack :3000: ✅ [x] tasks.md + Engram sdd/auth-contract-fixes/apply-progress #153 (recorded envelope shapes and mapping lines)
- Browser manual items 7/9/13/14/15 (login+returnTo, backend down, JS email blocking, cookie Max-Age ≈ 7200, `//evil.com` → `/`): ✅ [x] tasks.md (user-performed)

## Spec Compliance Matrix

| Requirement | Scenario | Evidence | Result |
|-------------|----------|----------|--------|
| Login Action & Session Lifetime | Cookie lifetime matches JWT expiry | login.ts:49-57 `sessionMaxAge` (`exp − floor(now/1000)`); smoke 14 (Max-Age ≈ 7200) | ✅ COMPLIANT |
| Login Action & Session Lifetime | Unreadable exp falls back to 7200 | login.ts:51-53, 56 (`decodeJwt` null → undefined → 7200; `remaining <= 0` → 7200) | ✅ COMPLIANT |
| Login Error Mapping | Invalid credentials | login.ts:37-38 UNAUTHORIZED → 'Credenciales inválidas'; setSession never called on error path; smoke 8 (401 envelope recorded) | ✅ COMPLIANT |
| Login Error Mapping | Unparseable error body | apiClient.ts:78,82 fallback `HTTP ${status}`; login.ts:43 | ✅ COMPLIANT |
| Login Error Mapping | Backend unavailable | apiClient.ts:71 plain `Error('Service unavailable')`; login.ts:45; smoke 9 | ✅ COMPLIANT |
| Route Protection & Redirects | Unauth protected route → `/auth/login?returnTo=%2F...` | middleware.ts:5,20-21; smoke 4 | ✅ COMPLIANT |
| Route Protection & Redirects | No dead `/login` targets | grep `['"]/login` in src/ → 0 matches; middleware.ts:5 PUBLIC_PATHS has no `/login` | ✅ COMPLIANT |
| Logout | Logout clears session, redirects `/auth/login` | logout.astro:6-7; logout action logout.ts:8; smoke 6 | ✅ COMPLIANT |
| Post-Login returnTo | Valid relative returnTo | login.ts:59-68 sanitizer; LoginForm.astro:13 hidden field; smoke 7 | ✅ COMPLIANT |
| Post-Login returnTo | Protocol-relative rejected | login.ts:63 `startsWith('//')` → '/'; smoke 15 | ✅ COMPLIANT |
| Post-Login returnTo | Scheme-containing rejected | login.ts:64 `includes('://')` → '/' | ✅ COMPLIANT |
| Post-Login returnTo | Missing returnTo → `/` | login.ts:61-62; LoginForm.astro:5 default '/' | ✅ COMPLIANT |
| Registration Form | Renders 3 required fields + button | RegisterForm.astro:16-25 (username text, email `type="email"`, password, submit); smoke 2 | ✅ COMPLIANT |
| Registration Form | Email format checked client-side | RegisterForm.astro:20 `type="email" required`; smoke 13 (browser blocks malformed) | ✅ COMPLIANT |
| Registration Form | Submits without JavaScript | actions/index.ts:19-27 `accept: 'form'`; use:form is progressive enhancement (design D2); static/structural | ✅ COMPLIANT |
| Register Server Action | Success redirects to `/auth/login` | register.ts:25 `redirectTo: '/auth/login'`; RegisterForm.astro:6-8; smoke 10 | ✅ COMPLIANT |
| Register Server Action | Duplicate shows backend message | register.ts:28-29 CONFLICT → message; smoke 11 (409 envelope recorded) | ✅ COMPLIANT |
| Register Server Action | Validation failure shows backend message | register.ts:28-29 BAD_REQUEST → message; smoke 12 (invalid email BAD_REQUEST recorded) | ✅ COMPLIANT |
| Register Server Action | Unparseable error → HTTP status | register.ts:31; apiClient fallback | ✅ COMPLIANT |
| Register Server Action | Backend unavailable → "Service unavailable" | register.ts:33; same network path as login smoke 9 | ✅ COMPLIANT |

**Compliance summary**: 20/20 scenarios compliant (12 static-only-or-mixed, 8 with runtime smoke evidence).

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| ApiError carries status/code/message | ✅ Implemented | apiClient.ts:17-29 (Error subclass, optional code) |
| Envelope parsed once in apiClient, non-2xx | ✅ Implemented | apiClient.ts:53-64, 75-96 |
| 401 clears session + code UNAUTHORIZED | ✅ Implemented | apiClient.ts:54-56, 62 |
| Network failure → plain Error, never ApiError | ✅ Implemented | apiClient.ts:67-72 (ApiError rethrown, others wrapped) |
| LoginResponse `{ token }` only | ✅ Implemented | login.ts:14-16 |
| maxAge from decodeJwt exp, fallback 7200 | ✅ Implemented | login.ts:49-57 |
| returnTo sanitizer rejects `//` and `://` | ✅ Implemented | login.ts:59-68 |
| No substring error matching (login/register) | ✅ Implemented | login.ts:36-46, register.ts:26-34 — code-based only |
| Register email in schema + body | ✅ Implemented | actions/index.ts:23; register.ts:17-21 |
| Register CONFLICT/BAD_REQUEST → message | ✅ Implemented | register.ts:28-29 |
| Forms: use:form + email + returnTo redirect | ✅ Implemented | RegisterForm.astro:11,20; LoginForm.astro:12,7-9 |
| Middleware /login removed, encoded returnTo | ✅ Implemented | middleware.ts:5,20-21 |
| index/logout redirects → /auth/login | ✅ Implemented | index.astro:12; logout.astro:7 |
| `use:form` TS augmentation | ✅ Implemented | src/env.d.ts:8-11 (verified by astro check 0 errors) |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 ApiError envelope mechanism, single parse point | ✅ Yes | apiClient.ts, actions switch on `error.code` |
| D2 use:form on both forms | ✅ Yes | RegisterForm.astro:11, LoginForm.astro:12 |
| D3 Session lifetime derived from JWT exp (decodeJwt) | ✅ Yes | login.ts:29,49-57 |
| D4 returnTo sanitizer: single `/`, reject `//` + `://` | ✅ Yes | login.ts:59-68 |
| D5 zod minimalism: `email: z.string().min(1)` | ✅ Yes | actions/index.ts:23 (presence only, not `.email()`) |
| Error envelope mapping table (login/register) | ✅ Yes | Matches design table row-for-row |
| File changes list (9 files) | ⚠️ Mostly | Implementation adds `src/env.d.ts` (new, needed for `use:form` under TS strict) — not listed in design file table or proposal rollback |

## Issues Found

**CRITICAL**: None

**WARNING**:
1. Worktree hygiene: `src/pods/odonto/odonto.astro` staged deletion is OUT of the change's declared scope (user-approved garbage cleanup per apply session, unrelated to auth-contract-fixes) and `src/env.d.ts` is untracked, while `.env` sits untracked too (must never be committed). The upcoming PR diff must be reviewed to confirm these belong; commit env.d.ts with the change, drop/revert the odonto deletion from the PR if not intended there, and keep .env out. — Evidence: `git status --short` (`D  src/pods/odonto/odonto.astro`, `?? src/env.d.ts`).

**SUGGESTION**:
1. Design rollback plan ("`git checkout` the nine touched files", design.md:108, proposal.md:54 "six files") predates `src/env.d.ts`; since it is a new untracked file, rollback also requires removing it. Update the rollback note during archive.
2. The zero-JS registration scenario (spec user-registration "Form submits without JavaScript") has structural evidence only (`accept: 'form'` + `use:form` progressive enhancement, build green). Optional: one manual JS-disabled submission to close it out fully.
3. `src/env.d.ts` uses 2-space indent vs the project's tabs — cosmetic; align if desired.

## Verdict

**PASS** — all 27 tasks complete, `pnpm astro check` (0/0/0) and `pnpm build` pass freshly, 20/20 spec scenarios compliant (static + smoke evidence), design decisions followed. Two non-blocking worktree/rollback notes for PR time; no defects found in implementation code.

---

# Verify Report v2 — Post-Fix Re-Verification

**Date**: 2026-09-11
**Trigger**: Two `ResponseSentError` bug fixes landed after v1 PASS; manual browser testing found them (redirects issued from components while `use:form` requires page-level response changes). This section re-verifies the full change with fresh evidence, superseding v1's evidence rows for the redirect scenarios.

## Completeness (updated)

| Metric | Value |
|--------|-------|
| Tasks total | 29 (11 core + 15 smoke sub-items + 2 new Phase 4 fixes) |
| Tasks complete | 29 |
| Tasks incomplete | 0 |

Two new items tracked in tasks.md under Phase 4, both checked:
- `Fix ResponseSentError on login redirect` — `Astro.redirect` moved from `LoginForm.astro` to page frontmatter `src/pages/auth/login.astro` via `Astro.getActionResult(actions.login)`.
- `Fix ResponseSentError on register redirect` — same move from `RegisterForm.astro` to `src/pages/auth/register.astro` via `Astro.getActionResult(actions.register)`.

## Build & Tests Execution (fresh, post-fix)

**Type-check**: ✅ Passed — run 2026-09-11 20:01:20
```text
> astro check
Result (22 files):
- 0 errors
- 0 warnings
- 0 hints
```
Exit code 0.

**Build**: ✅ Passed — run 2026-09-11 20:01:36–20:01:38
```text
> astro build
[build] output: "static" / mode: "server" / adapter: @astrojs/node
[build] ✓ Completed in 268ms.
[vite] ✓ built in 508ms / 855ms / 56ms
[build] Server built in 1.86s
[build] Complete!
```
Exit code 0.

**Tests**: N/A — no test runner (standard mode, `strict_tdd: false`). Manual browser tests performed by the user AFTER both fixes (see below).
**Coverage**: ➖ Not available.

## Fix Verification (static evidence, post-fix code)

### Fix 1 — Login redirect now in page frontmatter

| Check | Evidence | Result |
|-------|----------|--------|
| `Astro.redirect` removed from component | LoginForm.astro diff: `if (result?.data?.returnTo) { return Astro.redirect(...) }` deleted from component frontmatter | ✅ |
| Redirect present in page frontmatter | login.astro:8–12 — `const result = Astro.getActionResult(actions.login); if (result?.data?.returnTo) { return Astro.redirect(result.data.returnTo); }` | ✅ |
| Success path: sanitized returnTo (or `/`) | login.ts:31–34 `returnTo: sanitizeReturnTo(input.returnTo)` — always truthy on success (sanitizer falls back to `/`, login.ts:59–68) | ✅ |
| Error path: no redirect, error rendered | `result.data` undefined on failure → redirect block skipped; component renders `result.error.message` (LoginForm.astro:11–13) | ✅ |
| Astro documented rule honored | Response changes (redirects) only in page frontmatter; components never call `Astro.redirect` — grep confirms redirects only in pages (login/register/index/logout) | ✅ |

### Fix 2 — Register redirect now in page frontmatter

| Check | Evidence | Result |
|-------|----------|--------|
| `Astro.redirect` removed from component | RegisterForm.astro diff: redirect block deleted from component frontmatter | ✅ |
| Redirect present in page frontmatter | register.astro:8–12 — `Astro.getActionResult(actions.register)`; `if (result?.data?.redirectTo) { return Astro.redirect(result.data.redirectTo); }` | ✅ |
| Success path: `/auth/login` | register.ts:25 `{ success: true, redirectTo: '/auth/login' }` | ✅ |
| Error path: no redirect, error rendered | `result.data` undefined on failure → redirect skipped; component renders `result.error.message` (RegisterForm.astro:8–10) | ✅ |

### Manual browser confirmation (user-performed, post-fix)

- Login success with `returnTo` variants → redirects to sanitized target (or `/`): ✅ passed
- Login failure → error displayed on form (no redirect): ✅ passed
- Register success → redirects to `/auth/login`: ✅ passed
- Register failure → backend message displayed on form (no redirect): ✅ passed

## Regression Re-Check (per verify scope)

| Area | Evidence | Result |
|------|----------|--------|
| Middleware guard | middleware.ts:5 `PUBLIC_PATHS = ['/auth/login', '/auth/register']`; :20–21 redirect `/auth/login?returnTo=<encoded pathname>`; no `/login` references | ✅ No regression |
| Session cookie handling | login.ts:29 `setSession(cookies, token, sessionMaxAge(token))`; `sessionMaxAge` = `decodeJwt` `exp` − now, fallback 7200s (login.ts:49–57) | ✅ No regression |
| Register email payload | actions/index.ts:23 `email: z.string().min(1)`; register.ts:17–21 sends `email` in POST body | ✅ No regression |
| Components still render action errors | LoginForm.astro:11–13, RegisterForm.astro:8–10 (`result?.error` → `<p class="error">`) | ✅ |
| Dead `/login` redirect targets | grep `['"]/login` across `src/` → 0 matches (re-run post-fix) | ✅ Task 4.1 holds |

## Spec Compliance Matrix — Re-Confirmed (affected scenarios only; all 20 remain compliant)

| Requirement | Scenario | Evidence (post-fix) | Result |
|-------------|----------|----------|--------|
| Post-Login returnTo Navigation | Valid relative returnTo | login.ts sanitizer; login.astro:10–12 redirect; manual test | ✅ (supersedes v1 row) |
| Post-Login returnTo Navigation | Protocol-relative rejected | login.ts:63 `startsWith('//')` → `/`; manual `//evil.com` test | ✅ (supersedes v1 row) |
| Post-Login returnTo Navigation | Scheme-containing rejected | login.ts:64 `includes('://')` → `/` | ✅ COMPLIANT |
| Post-Login returnTo Navigation | Missing returnTo → `/` | login.ts:61–62 fallback; page redirects to `/` | ✅ (supersedes v1 row) |
| Register Server Action | Success redirects to `/auth/login` | register.ts:25; register.astro:10–12; manual test | ✅ (supersedes v1 row) |
| (All other 15 scenarios) | — | unchanged code; astro check/build green | ✅ COMPLIANT (unchanged) |

**Compliance summary (v2)**: 20/20 scenarios compliant; runtime evidence for redirect scenarios now = fresh `astro check`/`build` + post-fix manual browser tests.

## Correctness & Coherence (v2 delta)

- All design decisions D1–D5 unchanged and still followed.
- v1 coherence note ("9 files, mostly") still holds: change surface now spans 11 files incl. the two page files (`src/pages/auth/login.astro`, `src/pages/auth/register.astro`) which were not listed in design.md's file table — they were needed for the page-level redirect pattern. Rollback plan updated note still applies (see WARNING below).
- `src/env.d.ts` (untracked) remains required for `use:form` under TS strict — verified again by `astro check` 0 errors.

## Issues (v2)

**CRITICAL**: None

**WARNING**:
1. Carried forward from v1 (still open): worktree hygiene — `src/pods/odonto/odonto.astro` staged deletion is out of this change's scope (user-approved garbage cleanup) and must stay absent from disk; `.env` untracked must never be committed. Also: the two fixed page files (`login.astro`, `register.astro`) are now part of the change surface but absent from design.md's file table and the rollback note — update both during archive.
2. Dev server observed running WITHOUT `--background` (`astro dev`, PID 14536) plus SaludBack (`tsx src/index.ts`) during verification. Not started or stopped by this verify pass; server-side smoke tests were not re-run (user performs manual browser tests). Config validation still fresh via `astro check` + `build`.

**SUGGESTION**:
1. v1's spec-matrix evidence references for redirect rows (formerly `LoginForm.astro:13`, `RegisterForm.astro:6-8`) are stale after the move — v2 rows above supersede them; no action needed beyond archive keeping the report.
2. Optional: add a regression note in the auth spec that redirects for `use:form` actions MUST live in page frontmatter (Astro rule), to prevent re-introduction of the ResponseSentError pattern.

## Verdict (v2)

**PASS** — re-verified 2026-09-11 after both ResponseSentError fixes. Fresh `pnpm astro check` (0/0/0, exit 0) and `pnpm build` (Complete!, exit 0) both pass; 29/29 tasks complete; both redirect fixes confirmed in page frontmatter with components rendering errors only; manual browser tests (user-performed, post-fix) pass for login/register success redirects and error display; middleware guard, session cookie handling, and register email payload show no regression. v1's two non-blocking worktree/rollback notes carry forward.