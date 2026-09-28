# User Registration Specification

## Purpose

Self-service patient registration via frontend. Mirrors the existing login pattern: zero-JS Astro form, server action, SSR page. New capability alongside `auth` (login/session/logout).

## Requirements

### Requirement: Registration Page Route

The system SHALL serve a registration page at `/auth/register` as an SSR page (prerender = false). The page SHALL display a heading and render the registration form component.

#### Scenario: Registration page renders for unauthenticated user

- GIVEN the user has no active session
- WHEN the user navigates to `/auth/register`
- THEN the page renders with a heading and the registration form
- AND the page uses the shared Layout component

#### Scenario: Registration page is accessible without authentication

- GIVEN the user has no active session
- WHEN the user navigates to `/auth/register`
- THEN the middleware does NOT redirect to `/login`
- AND the page renders normally

### Requirement: Registration Form

The system SHALL render a form with three required fields: `username` (text), `email` (`type="email"`), and `password` (password). The `email` field SHALL rely on `type="email"` for minimal frontend format validation; the backend remains the authority for strict validation. The form SHALL use `use:form` for zero-JS progressive enhancement. The form SHALL POST to the `register` server action.

#### Scenario: Form renders with required fields

- GIVEN the user is on `/auth/register`
- WHEN the page loads
- THEN the form displays username, email, and password inputs
- AND all three fields are marked as required
- AND a submit button is visible

#### Scenario: Email format checked client-side

- GIVEN the user is on `/auth/register`
- WHEN the user submits an email value without a valid format
- THEN the browser blocks submission via native `type="email"` validation
- AND no request reaches the server action

#### Scenario: Form submits without JavaScript

- GIVEN the user has JavaScript disabled
- WHEN the user fills in username, email, and password and clicks submit
- THEN the form submits via standard HTML POST to the register action
- AND the server processes the request and returns a response page

### Requirement: Registration Server Action

The system SHALL define a `register` action in `src/actions/index.ts` accepting `{ username: string, email: string, password: string }` via form data, with all three fields required by the action input schema. The action SHALL call `POST /auth/register` with all three fields. On success the action SHALL return a result that redirects the user to `/auth/login`. The action SHALL parse backend errors as the envelope `{ error: { code, message } }`: code `CONFLICT` (duplicate username/email) and code `BAD_REQUEST` (validation failure) SHALL surface the backend `message` on the form; unparseable envelopes SHALL fall back to the HTTP status code. The action MUST NOT match error text by substring (e.g. status numbers or the words "duplicate"/"validation").

#### Scenario: Successful registration redirects to login

- GIVEN the username and email are not already taken
- WHEN the user submits valid username, email, and password
- THEN the backend returns 201
- AND the action returns a success result
- AND the form redirects the user to `/auth/login`

#### Scenario: Duplicate conflict shows backend message

- GIVEN a user with the submitted username or email already exists
- WHEN the user submits the registration form
- THEN the backend returns an envelope with code `CONFLICT`
- AND the action returns an error result with the backend's message
- AND the message is displayed on the form

#### Scenario: Validation failure shows backend message

- GIVEN a submitted field fails backend validation
- WHEN the user submits the registration form
- THEN the backend returns an envelope with code `BAD_REQUEST`
- AND the action returns an error result with the backend's validation message
- AND the message is displayed on the form

#### Scenario: Unparseable error response

- GIVEN the backend responds with a non-envelope error body and status 400
- WHEN the user submits the registration form
- THEN the action returns an error result derived from the HTTP status code
- AND the error message is displayed on the form

#### Scenario: Backend unavailable

- GIVEN the backend service is unreachable
- WHEN the user submits the registration form
- THEN the action returns a generic "Service unavailable" error
- AND the error message is displayed on the form

### Requirement: Middleware Public Path

The system SHALL include `/auth/register` in the `PUBLIC_PATHS` array in `src/middleware.ts`. Unauthenticated requests to `/auth/register` SHALL pass through without redirect.

#### Scenario: Register path is public

- GIVEN a user has no active session
- WHEN the user requests `/auth/register`
- THEN the middleware does not redirect
- AND the request proceeds to the page handler