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

The system SHALL render a form with two required fields: `username` (text) and `password` (password). The form SHALL use `use:form` for zero-JS progressive enhancement. The form SHALL POST to the `register` server action.

#### Scenario: Form renders with required fields

- GIVEN the user is on `/auth/register`
- WHEN the page loads
- THEN the form displays a username text input and a password input
- AND both fields are marked as required
- AND a submit button is visible

#### Scenario: Form submits without JavaScript

- GIVEN the user has JavaScript disabled
- WHEN the user fills in username and password and clicks submit
- THEN the form submits via standard HTML POST to the register action
- AND the server processes the request and returns a response page

### Requirement: Registration Server Action

The system SHALL define a `register` action in `src/actions/index.ts` accepting `{ username: string, password: string }` via form data. The action SHALL call `POST /auth/register` on the backend with the same payload. The action SHALL handle three backend response codes: 201 (success), 409 (duplicate username), 400 (validation error).

#### Scenario: Successful registration

- GIVEN the username is not already taken
- WHEN the user submits valid username and password
- THEN the backend returns 201
- AND the action returns a success result
- AND the form redirects the user to `/login`

#### Scenario: Duplicate username

- GIVEN a user with the submitted username already exists
- WHEN the user submits the registration form
- THEN the backend returns 409
- AND the action returns an error result with a message indicating the username is taken
- AND the error message is displayed on the form

#### Scenario: Invalid input

- GIVEN the submitted username or password fails backend validation
- WHEN the user submits the registration form
- THEN the backend returns 400
- AND the action returns an error result with the backend's validation message
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
