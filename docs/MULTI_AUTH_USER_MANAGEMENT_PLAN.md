# Implementation Plan: Multi-User Auth and User Management

## Overview

Build a secure, invite-only multi-user layer around the existing Supabase Auth setup without changing the shared mobile app contract. The implementation will use the existing `public.users` role table, `public.user_projects` membership table, an Edge Function for privileged Auth Admin API operations, and a new static User Management page.

## Architecture Decisions

1. **Keep `public.users` as the profile/role source of truth.** The sibling Field app already reads it, and adding a second profile table would split authorization state.
2. **Use an Edge Function for privileged user operations.** Supabase Auth Admin APIs require a secret/service-role key, which must never be exposed in a browser.
3. **Use invite-only creation.** The current login page already has no public signup form; the admin function will be the controlled creation path.
4. **Use existing roles first.** `field_worker`, `office_staff`, and `admin` remain the only role values until the team explicitly defines finer-grained permissions.
5. **Separate User Management from the Data Browser.** `admin.html` stays focused on table data; `user-admin.html` is a smaller, purpose-built user directory.
6. **Make deactivation reversible.** `is_active` is enforced by the guard and RLS; permanent deletion is excluded from the first release.

## Dependency Graph

```text
Shared users/project schema
        |
        +--> RLS helpers and last-admin protection
        |          |
        |          +--> admin-users Edge Function contract
        |                         |
        |                         +--> browser API client
        |                                        |
        |                                        +--> user-admin.html UI
        |
        +--> auth-guard active/admin checks
                       |
                       +--> admin.html + user-admin.html protection
```

## Task List

### Phase 1: Contract and safety foundation

- [ ] **Task 1: Commit the specification and ADR**
  - Acceptance: spec, threat model, contract, and architecture rationale are in `docs/`.
  - Verify: review the documents against the existing MSR and Field app contracts.
  - Files: `docs/MULTI_AUTH_USER_MANAGEMENT_SPEC.md`, `docs/MULTI_AUTH_USER_MANAGEMENT_PLAN.md`, `docs/decisions/001-supabase-admin-user-management.md`

- [ ] **Task 2: Add shared database migration**
  - Acceptance: migration is idempotent, defaults new users to `field_worker`, adds `is_active`, preserves existing roles, tightens `users`/`user_projects` RLS, and blocks last-admin removal.
  - Verify: SQL parse/review checks and a local Supabase migration test if the CLI is available.
  - Files: `supabase/migrations/012_admin_user_management.sql`, `tests/auth-migration.test.js`

### Checkpoint: database contract

- [ ] Migration is reviewed before applying to production.
- [ ] Existing mobile role values and project queries remain valid.
- [ ] A real admin account is identified for the bootstrap step.

### Phase 2: Privileged operation path

- [ ] **Task 3: Add Edge Function input/output helpers and tests**
  - Acceptance: validated request shapes and consistent error responses exist before handler implementation.
  - Verify: Node contract tests are red before implementation, then green after implementation.
  - Files: `supabase/functions/admin-users/validation.ts`, `tests/admin-users-function.test.js`

- [ ] **Task 4: Implement admin-users Edge Function**
  - Acceptance: GET list, POST invite, PATCH update; bearer auth; active-admin authorization; allowlisted output; audit writes; last-admin safeguards.
  - Verify: local Edge Function tests and manual invocation with a non-secret test account.
  - Files: `supabase/functions/admin-users/index.ts`, `supabase/functions/admin-users/validation.ts`

### Checkpoint: authorization boundary

- [ ] Unauthenticated requests return `401`.
- [ ] Authenticated non-admin requests return `403`.
- [ ] No browser or function response contains privileged keys or tokens.
- [ ] Admin invite/update operations are audited.

### Phase 3: Browser integration

- [ ] **Task 5: Add reusable client and role-aware guards**
  - Acceptance: current user profile is loaded, inactive users are signed out/redirected, and page-level admin access is enforced.
  - Verify: unit tests for role decisions plus current login/project-scope tests.
  - Files: `js/utils/user-access.js`, `js/utils/admin-users-client.js`, `js/utils/auth-guard.js`, `admin.html`

- [ ] **Task 6: Build User Management page**
  - Acceptance: responsive accessible list, search, invite form, edit form, active/inactive status, role selection, project membership selection, loading/error/empty states, confirmation for deactivation.
  - Verify: browser DOM, keyboard, responsive, console, and network checks.
  - Files: `user-admin.html`, `user-admin.js`, `styles.css`, `js/utils/sidebar.js`

### Checkpoint: end-to-end flow

- [ ] Admin can sign in, open User Management, invite, edit, deactivate, and reactivate a test account.
- [ ] Non-admin user is redirected from both admin pages.
- [ ] Existing dashboard and mobile profile/project flows still load.

### Phase 4: Release hardening

- [ ] **Task 7: Documentation and deployment checklist**
  - Acceptance: SQL apply order, admin bootstrap, Edge Function deployment, secrets, redirect URL, and rollback notes are documented.
  - Verify: a second engineer can follow the checklist without reading source code.
  - Files: `AUTH_USER_MANAGEMENT_DEPLOYMENT.md`, `README.md`, `TESTING.md`

- [ ] **Task 8: Final verification**
  - Acceptance: all Node tests pass, static files are syntax-checked, browser console is clean, and no secrets are in the diff.
  - Verify: `node tests/*.test.js`, `node --check`, `git diff --check`, `git diff --cached` secret scan.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Service-role key reaches the browser | Critical | Edge Function only; static client calls function with user bearer token. |
| Existing mobile app expects old role values | High | Preserve `public.users` and existing enum-like text values. |
| User deactivation leaves direct API access | High | Add active-user checks to membership/data policies, not only UI guards. |
| Last admin is removed | High | Database trigger plus Edge Function validation. |
| Migration locks out existing users | High | Backfill existing Auth users, preserve current roles, dry-run against a backup/local instance. |
| Large user directory is slow | Medium | Server-side pagination and search; never load all Auth users into the browser. |
| Supabase invite email is unbranded | Low | Use default invite flow now; customize SMTP/template in a later slice. |

## Rollback

1. Disable the User Management navigation link and page deployment if UI issues occur.
2. Keep the Edge Function deployed but reject new operations if the database migration is rolled back.
3. Restore the previous static deploy through Netlify if the browser integration breaks.
4. Do not drop `public.users`, `public.user_projects`, or existing role data as part of a UI rollback.
