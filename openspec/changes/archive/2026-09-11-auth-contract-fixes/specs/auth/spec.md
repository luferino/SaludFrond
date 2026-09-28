# Auth Specification

## Purpose

Authentication for SaludFrond: login, session persistence, route protection, logout, and post-login navigation. Formalizes existing auth behavior plus the auth-contract fixes: `/auth/login` redirect targets, JWT-exp-derived session lifetime, backend envelope error mapping, and returnTo sanitization.

## Requirements

### Requirement: Login Action and Session Cookie Lifetime

The system SHALL serve a public login page at `/auth/login` rendering a form with required `username` and `password` fields that posts to the `login` server action. The action SHALL call `POST /auth/login` and, on success, persist the returned token in the session cookie. The cookie `maxAge` SHALL equal the JWT `exp` claim (decoded via `decodeJwt`) minus the current epoch seconds. The action SHALL treat the login response as carrying only the token and MUST derive the session lifetime from the JWT, not from a response field. When `exp` is missing, unreadable, or not greater than now, the action SHALL fall back to 7200 seconds.

#### Scenario: Cookie lifetime matches JWT expiry

- GIVEN the backend returns a token whose `exp` is 3600 seconds in the future
- WHEN login succeeds
- THEN the session cookie is set with a `maxAge` of 3600 seconds
- AND the cookie persists the token

#### Scenario: Unreadable exp falls back to backend default

- GIVEN the backend returns a token without a readable `exp`
- WHEN login succeeds
- THEN the session cookie is set with a `maxAge` of 7200 seconds

### Requirement: Login Error Mapping

The login action SHALL map failures from the backend error envelope `{ error: { code, message } }`. The action SHALL return an invalid-credentials error for code `UNAUTHORIZED`, SHALL surface the backend `message` for code `BAD_REQUEST`, and SHALL fall back to the HTTP status code when the envelope is unparseable. The action MUST NOT match error text by substring (e.g. status numbers or keywords).

#### Scenario: Invalid credentials

- GIVEN the backend rejects the credentials with code `UNAUTHORIZED`
- WHEN the user submits the login form
- THEN the action returns an invalid-credentials error
- AND no session cookie is set

#### Scenario: Unparseable error body

- GIVEN the backend responds with a non-envelope error body and status 400
- WHEN the user submits the login form
- THEN the action returns an error derived from the HTTP status code

#### Scenario: Backend unavailable

- GIVEN the backend service is unreachable
- WHEN the user submits the login form
- THEN the action returns a generic "Service unavailable" error

### Requirement: Route Protection and Auth Redirect Targets

The system SHALL protect all routes except the public paths `/auth/login` and `/auth/register`. Unauthenticated requests to protected routes SHALL redirect to `/auth/login?returnTo=<encoded pathname>`. All auth redirects (middleware guard, index page, logout page, register success) MUST target `/auth/login` and MUST NOT reference the non-existent `/login` path.

#### Scenario: Unauthenticated request to a protected route

- GIVEN the user has no valid session
- WHEN the user requests a protected route such as `/profile`
- THEN the middleware redirects to `/auth/login?returnTo=%2Fprofile`

#### Scenario: No dead /login redirect targets

- GIVEN the auth-related code
- WHEN every auth redirect target is inspected
- THEN none reference the non-existent `/login` path

### Requirement: Logout

The system SHALL define a logout flow that clears the session cookie and redirects to `/auth/login`.

#### Scenario: Logout clears the session

- GIVEN the user has an active session
- WHEN the user requests the logout page
- THEN the session cookie is cleared
- AND the user is redirected to `/auth/login`

### Requirement: Post-Login returnTo Navigation

The system SHALL navigate the user to the sanitized `returnTo` after successful login. The sanitizer SHALL accept only root-relative paths beginning with exactly one `/`, SHALL reject protocol-relative values (starting with `//`) and values containing `://`, and SHALL fall back to `/` for missing or invalid values.

#### Scenario: Valid relative returnTo

- GIVEN the login request carries `returnTo=/appointments`
- WHEN login succeeds
- THEN the user is redirected to `/appointments`

#### Scenario: Protocol-relative returnTo rejected

- GIVEN the login request carries `returnTo=//evil.com`
- WHEN login succeeds
- THEN the user is redirected to `/`

#### Scenario: Scheme-containing returnTo rejected

- GIVEN the login request carries `returnTo=https://evil.com`
- WHEN login succeeds
- THEN the user is redirected to `/`

#### Scenario: Missing returnTo

- GIVEN the login request carries no `returnTo`
- WHEN login succeeds
- THEN the user is redirected to `/`