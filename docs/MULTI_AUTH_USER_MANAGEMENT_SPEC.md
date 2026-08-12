# Spec: Multi-User Authentication and User Management

## Objective

Extend the Invenio Field MSR static web app from a single shared login experience to a managed, multi-user system backed by the existing Supabase Auth and shared `public.users` / `public.user_projects` tables.

An administrator should be able to invite users, assign a compatible role, activate or deactivate access, edit display names, and assign project memberships from a protected User Management page. Existing users must continue to use the current email/password login and password-reset flow. The existing mobile Field app must continue to read the same profile and project tables.

## Assumptions

1. “Multi auth user setup” means multiple managed Supabase Auth users, not a new social-login provider in this first slice.
2. Email/password remains the authentication provider; account creation is invite-only from the admin surface.
3. The shared backend contract is the existing `public.users` table with roles `field_worker`, `office_staff`, and `admin`, plus `public.user_projects` and `public.projects`.
4. `admin.html` remains the existing data browser. A new `user-admin.html` page will manage users so the two administrative concerns stay separate.
5. Supabase Edge Functions are available for the project. The browser will never receive or contain a Supabase secret/service-role key.
6. Deactivation is reversible and will be enforced by the app guard and database access policies. Permanent Auth-user deletion is outside the first slice.

## Tech Stack

- Static HTML/CSS/JavaScript deployed from `Invenio Field MSR` via Netlify.
- Supabase Auth and Postgres.
- Supabase Edge Function in TypeScript/Deno for privileged Auth Admin API operations.
- Existing Bootstrap 5.3.2 and Invenio design tokens.
- Node.js built-in `assert` tests, matching the existing test style.

## Commands

Run from `Invenio Field MSR`:

```bash
node tests/login-reset.test.js
node tests/project-scope.test.js
node tests/user-access.test.js
node tests/admin-users-client.test.js
```

Run the Edge Function locally when the Supabase CLI is available:

```bash
supabase functions serve admin-users --env-file supabase/functions/.env.local
```

Deploy the function only after the SQL migration has been applied and the function has passed local tests:

```bash
supabase functions deploy admin-users
```

Production secrets are set in Supabase Edge Function secrets, never in this repository:

```bash
supabase secrets set --project-ref lzroduricxyshgyjdkki SUPABASE_SERVICE_ROLE_KEY="<value>"
```

## Project Structure

```text
admin.html                         existing data browser, admin-only after this feature
user-admin.html                    new user-management page
js/utils/auth-guard.js             session, active-user, and page-level admin guard
js/utils/user-access.js            profile/role helpers and protected API client
js/utils/admin-users-client.js     typed client for the Edge Function contract
user-admin.js                      user-management page behavior
supabase/migrations/012_*.sql      shared users/project security migration
supabase/functions/admin-users/    privileged Edge Function
tests/user-access.test.js          pure authorization/helper tests
tests/admin-users-client.test.js   request/response contract tests
docs/decisions/001-*.md            architecture decision record
```

## Contract

### Roles

The first implementation preserves the existing shared role values:

- `admin`: can use User Management and the existing Data Browser; can invite and edit users and memberships.
- `office_staff`: authenticated operational user; cannot manage users.
- `field_worker`: authenticated operational user; cannot manage users.

The database remains the final authorization boundary. The UI only hides actions that the current user cannot perform.

### Edge Function

Function URL:

```text
POST/GET https://lzroduricxyshgyjdkki.supabase.co/functions/v1/admin-users
```

Every request requires the current Supabase access token in `Authorization: Bearer <token>`. The function returns one consistent JSON error shape:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Administrator access is required"
  }
}
```

Endpoints:

```text
GET  /admin-users?page=1&pageSize=50&search=
     -> { data: UserAdminRecord[], pagination: { page, pageSize, totalItems, totalPages } }

POST /admin-users
     body: { action: "invite", email, fullName, role, projectIds[] }
     -> { data: UserAdminRecord }

PATCH /admin-users
     body: { userId, fullName?, role?, isActive?, projectIds[]? }
     -> { data: UserAdminRecord }
```

`UserAdminRecord` is an allowlisted shape and never includes access tokens, refresh tokens, password data, or secret metadata:

```js
{
  id,
  email,
  fullName,
  role,
  isActive,
  createdAt,
  lastSignInAt,
  projectIds
}
```

### Error Semantics

- `400` — malformed request or unsupported action.
- `401` — missing or invalid session.
- `403` — authenticated but inactive or not an admin.
- `404` — target user or project not found.
- `409` — operation would remove the last active admin or violate a uniqueness constraint.
- `422` — semantically invalid email, role, or project assignment.
- `500` — generic server error; internal provider details stay in function logs.

## Security and Threat Model

Trust boundaries:

1. Browser form fields and query strings are untrusted.
2. The browser-to-Edge-Function request is authenticated but still requires server-side authorization.
3. Supabase Auth Admin API and the service-role/secret key are server-only.
4. Database rows are protected by RLS and server-side allowlists.

Controls:

- The Edge Function validates the bearer session with Supabase Auth and verifies the caller is an active `admin` in `public.users`.
- The function uses the privileged Auth Admin API only after authorization; the key is read from Edge Function secrets.
- New accounts default to `field_worker`; role metadata from an untrusted signup payload is never trusted.
- Admins cannot deactivate or demote the last active admin.
- User management actions are written to an audit table with actor, target, action, and sanitized details.
- User-facing HTML uses `textContent`/DOM APIs for untrusted values; no user value is interpolated into executable HTML.
- Existing project membership and project-scoped RLS are tightened to require active membership.
- The existing data browser and new User Management page require an active admin profile.

## Testing Strategy

- Unit tests for role predicates, admin-only page decisions, input normalization, query-string construction, and error normalization.
- SQL review tests/checks for the migration: idempotency, role allowlist, trigger default, RLS policy presence, and last-admin protection.
- Edge Function tests with a fake Auth/database boundary for `401`, `403`, `400`, `409`, successful invite, and successful update paths.
- Browser verification using Chrome DevTools: login, non-admin redirect, admin list, invite form validation, edit/deactivate flow, console, network, and responsive layout.
- No automated test will use or print a real service-role key.

## Boundaries

### Always

- Preserve the existing `public.users` and `public.user_projects` contracts used by the mobile app.
- Enforce authorization in the Edge Function and database, not only in JavaScript.
- Keep privileged secrets out of source control and browser requests.
- Run existing tests plus new tests after each implementation slice.
- Keep user list responses allowlisted and paginated.

### Ask First

- Adding OAuth/SSO/MFA providers.
- Introducing new role names or changing the meaning of existing mobile roles.
- Permanent user deletion or bulk destructive actions.
- Changing the Supabase project, SMTP provider, or production secrets.
- Applying the SQL migration to the live database or deploying the Edge Function.

### Never

- Put `service_role`, secret keys, passwords, access tokens, or refresh tokens in the static app.
- Let an invited user choose an elevated role through client metadata.
- Trust a client-side role check as the authorization boundary.
- Return raw Auth Admin API objects to the browser.
- silently demote or deactivate the last administrator.

## Success Criteria

- [ ] Existing login and password reset still work.
- [ ] A non-admin cannot open `admin.html` or `user-admin.html` and receives a safe redirect.
- [ ] An active admin can list users with pagination and search.
- [ ] An active admin can invite a user with a selected existing role and project memberships.
- [ ] An active admin can edit name, role, active status, and memberships.
- [ ] The last active admin cannot be deactivated or demoted.
- [ ] Deactivated users cannot pass the app guard or call the admin function.
- [ ] User-management actions are audited without secrets.
- [ ] Existing mobile app profile/project queries continue to work.
- [ ] Tests pass and browser console has no new errors.

## Open Questions

1. Should `office_staff` be allowed to edit operational data but not the existing data browser? The first implementation assumes yes: only `admin` can access either administrative page.
2. Should the first invitation email use Supabase's default template, or do you want a branded/custom SMTP flow later? The first implementation uses the existing Supabase invite email.
3. Should project assignment management live in this page now? The first implementation includes it because `user_projects` already exists and the app is multi-project.
