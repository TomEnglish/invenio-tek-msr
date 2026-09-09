# Platform administration and reliability implementation

This plan implements the September 8 review across the MSR web app and its companion Field app. The existing shared Supabase users/projects model and the three roles remain the source of truth. The user's request to plan and implement authorizes local implementation and verification. Applying production migrations, sending real invitations, and releasing deployed applications are separate release actions after verification.

## Product and permission decisions

- Administrators manage users, project access, projects, and corrections. Ordinary office staff manage procurement, locations, schedules, and exception decisions within assigned projects.
- Field workers receive, inspect, transfer, issue, and ship material within assigned active projects through validated operations. They cannot administer users, overwrite operational history, change procurement, or resolve office exceptions.
- Deactivated users and users without project assignments cannot read or write project data. Existing tokens must not bypass these rules. Completed projects can be read; archived projects are unavailable for operational writes.
- User membership/profile edits and audit history commit in one transaction. The last active administrator cannot be removed, including concurrent attempts. Administrative changes require an authenticated active administrator even when a backend service key executes the transaction.
- Invitations have explicit pending, expired, accepted, and cancelled states. Password setup handles both recovery and invitation sessions. Cancellation removes app access while preserving identity/history. Sending email remains an external operation with a visible recoverable error state.
- Receiving and material movements carry stable operation identifiers. Retrying an operation does not create a second receipt or deduct quantity twice. Photos are uploaded separately with deterministic paths so an interrupted upload can resume.
- Every offline action, draft, and read cache belongs to a user/project. Unknown legacy queue items are retained for review instead of being replayed under a guessed identity/project.
- The existing design is retained. New UI uses its styles, accessible labels, loading/error states, and mobile layouts.

## Dependency and task plan

Tasks are applied in sequence, with focused tests and a local checkpoint at each boundary. Independent reproduction tests may be written by a test agent as prescribed by the test-driven-development skill.

| Task | Implementation and files | Acceptance and verification | Dependencies |
|---|---|---|---|
| 1 | Disposable PostgreSQL harness under `tests/database/`; apply the shared baseline and new migrations | Real SQL tests run without production credentials; existing permissive access reproduced before fixing | None |
| 2 | Add migration 013: active-user/project/role checks; protect audit, views, storage and legacy quantity function | Wrong-project, inactive, anonymous, and non-admin requests fail; role-appropriate reads/actions succeed | 1 |
| 3 | Add transactional administrative RPC and serialized last-admin protection; record before/after audit | Failed membership replacement rolls back profile and memberships; concurrent demotions retain an admin; direct mutation cannot bypass audit | 2 |
| 4 | Update `admin-users` Edge Function and validation/client contract | Filtered paginated users, named projects, status metadata, audit endpoint, transactional edits, structured errors; Deno and client tests pass | 3 |
| 5 | Complete invitation acceptance and recovery in a shared login helper | Invitation/recovery intent survives URL cleanup; valid setup stays on password form; expiry/errors are readable; pending invites can be resent/cancelled | 4 |
| 6 | Update Users & Access directory, filters and per-user history | Admin can inspect roles/status/project names, invite/edit/resend/cancel, and inspect change history; keyboard and narrow-screen checks pass | 4,5 |
| 7 | Add Projects administration, selector and access-pending screen; complete query scoping | Switching projects updates actual queries and header; no assignments never falls back to another job; inventory/outside shops are scoped | 2,4 |
| 8 | Add transactional Field receiving, transfer, issue and shipment RPCs | Wrong-project references and invalid quantities rejected; partial receipt quantity correct; injected failure rolls back; duplicate operation returns original result | 2 |
| 9 | Update Field API calls and photo persistence | APIs use stable operation IDs; failed photos can resume without duplicate receipt; existing Field types/lint pass | 8 |
| 10 | Scope Field auth, cache, drafts and offline queue; add sync recovery screen | Account/project switch cannot reveal/replay another context; no-photo-loss submission; failed items visible/retryable; web startup works | 2,9 |
| 11 | Add actionable search and work inbox to MSR; exception ownership/due dates and hold status | Search links to existing record pages, inbox uses live project exceptions; hold remains open; office users can assign/review/resolve | 2,7 |
| 12 | Align Field Admin editor and role navigation with schema and corrections | Field worker cannot open admin; choices match constraints; correction requires a reason and audit; lint passes | 2,8 |
| 13 | Integration, browser, compatibility and release checks; update deployment docs | SQL + Node + Deno + Field checks pass; responsive UI verified; rollout order, email setup, migration ownership, and rollback documented | All |

## API contracts

Existing `/functions/v1/admin-users` remains the only browser path to privileged Auth APIs. GET accepts `resource=users|projects|audit`, bounded page/pageSize/search and role/status/project filters. POST actions include `invite`, `resend_invite`, `cancel_invite`, and project creation. PATCH updates either a user or project using allowlisted fields. Failures use `{error:{code,message}}`; stale or conflicting state returns 409. Invitation errors must distinguish an already-created account from a request that never reached the mail provider.

New database RPCs derive the acting user from `auth.uid()` for ordinary app actions. Service-only administrative RPCs accept the verified actor, recheck that actor, and are not executable by browser roles. Updates are denied by default outside explicit role/action rules. Operation IDs are immutable UUIDs keyed to user, project, action, and request data; a duplicate with different data is a conflict.

## Verification commands

MSR root:

```sh
node --test tests/*.test.js
deno test tests/admin-users-validation.test.ts
deno check supabase/functions/admin-users/index.ts
bash tests/database/run.sh
git diff --check
```

Field root:

```sh
npm run lint
node --test tests/*.test.cjs
CI=1 npm run web -- --localhost --port 8091
```

Browser verification uses localhost with a fixture backend for admin UI interaction; production data is not edited. PostgreSQL tests use a disposable database with Supabase-compatible auth/storage fixtures, not an emulated SQL parser. Real email delivery and native-device camera/file retention require deployment/device checks and must be reported separately.

## Release sequencing and compatibility

1. Save current deployed versions and back up the shared database; inspect actual roles, membership gaps, policies, bucket visibility, and grants.
2. Apply the baseline MSR user-management migration only if missing, then the new hardening/operation migrations. Verify existing service sync jobs authenticate with a server-only service credential; old anonymous sync jobs will be denied.
3. Deploy the admin Edge Function and configure invitation redirect/expiry settings. Run authenticated role-denial and invitation tests with designated test accounts.
4. Release the MSR static files and the compatible Field build together. The new operation APIs replace unsafe direct write sequences. Old mobile builds must be updated before operational writes resume.
5. Confirm public User Management URL, navigation, local-to-deployed revision, and smoke checks. Do not roll security policies back to permissive defaults to repair a frontend problem.

## Implementation record

Progress, commands, results, and any remaining environment limitations will be recorded here as each task completes. No stage is marked complete based only on source-text assertions or a mocked happy path.
