# Active role switching

A Student (`estudiante`, or legacy `student`) can also hold an additional Reception role granted by an administrator. The person keeps one identity; the session works with one active role at a time. Login always starts with the primary role, and `/auth/me` keeps returning that primary role.

## Header switch

For Student and Reception sessions the layout reads `GET /auth/roles` (`{active_role, available_roles}`) on each render and, when another switchable role is available, shows «Rol activo: Estudiante» or «Rol activo: Recepción» with one «Cambiar a …» button. Other roles skip this lookup. The response is validated strictly (exact keys, known role names, no duplicates, active role included); anything else hides the switch. This lookup never clears the session; an expired token is handled by the next page request.

The button posts the `switchActiveRole` form action to `/active-role`. Only `estudiante`, `student` and `reception` are ever requested, in a single `POST /auth/active-role` with `{role}`. The returned `{token}` replaces the session only when it carries the requested role for the same `sub` and `username` and has an expiry. A successful switch redirects home. A 401 clears the session and sends the user to login; a 403 shows «Tu cuenta no tiene habilitado ese rol. Pedile a un administrador que lo revise.»; any other failure shows «No se pudo cambiar el rol. Intentá nuevamente.» No other role is tried as a fallback.

## Revocation

The backend checks the live Reception grant on every request. When an administrator revokes it, Reception tokens issued from that grant are rejected with 401, so the next page clears the session and asks for login; logging in again starts with the primary role and no switch. A later regrant does not revive those old tokens.

## Verification

`tests/active-role.test.mjs` covers the role lookup, the switch action, token checks and error copy with scripted fetch mocks and synthetic identifiers. A live run against the backend (multiple-role feature T4) exercised login, switching both ways, Reception pages, revocation, the 401 redirect to login, the 403 copy and regrant on a disposable database.
