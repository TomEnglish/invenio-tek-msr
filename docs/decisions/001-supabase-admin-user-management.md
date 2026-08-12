# ADR-001: Use a Supabase Edge Function for Admin User Management

## Status

Accepted for implementation, pending human review of the feature specification.

## Date

2026-08-12

## Context

Invenio Field MSR is a static Netlify application. It already authenticates users with Supabase Auth and shares `public.users`, `public.projects`, and `public.user_projects` with the mobile Field app. The requested User Management page needs to invite and update Auth users, but Supabase Auth Admin APIs require a secret/service-role key.

Putting that key in `supabase-config.js` or browser JavaScript would allow any visitor to administer the entire Auth project and bypass RLS.

## Decision

Use a Supabase Edge Function named `admin-users` as the privileged boundary:

1. The browser sends the current user's Supabase access token.
2. The function validates the session and loads the caller's active role from `public.users`.
3. Only active `admin` users may invoke list/invite/update operations.
4. The function uses the Supabase Auth Admin API with the Edge Function secret key.
5. The function returns a small allowlisted user shape and writes an audit row.

The existing `public.users` table remains the role source of truth. The first release preserves the current role values rather than introducing a second table or a custom JWT hook.

## Alternatives Considered

### Browser calls `supabase.auth.admin`

Rejected: requires the secret/service-role key in a client-accessible application and bypasses RLS.

### New `user_profiles` table

Rejected: the sibling mobile app already reads `public.users`; a second source of truth would create synchronization and authorization drift.

### Custom Access Token Hook with role claims

Deferred: custom claims can improve policy performance, but the current project already has a stable `public.is_admin()`/`public.users` pattern. Introducing a hook would add dashboard configuration and token-refresh timing concerns to the first release.

### Netlify Function

Deferred: it could hold a server secret, but the database/Auth boundary already lives in Supabase. An Edge Function keeps authorization and secrets close to Supabase and can be deployed with the existing project tooling.

## Consequences

- The web app remains static and does not need a new server runtime.
- Supabase Edge Function secrets must be configured and deployment becomes an explicit release step.
- The function must enforce authorization independently of the UI.
- User-management operations can be audited centrally.
- Existing mobile role and project membership behavior is preserved.

## References

- Supabase Auth user administration: https://supabase.com/docs/guides/auth/users
- Supabase `updateUserById`: https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Supabase Edge Function secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
