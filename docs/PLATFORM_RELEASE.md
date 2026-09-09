# Administration and reliability release

The administration and reliability feature is implemented in both repositories. See the production release record below for deployment status and remaining verification.

## What users receive

- **Users & Access:** searchable and filterable directory, roles, active/inactive access, named project memberships, invitation expiry, resend/cancel, conflict handling, and per-user history.
- **Projects:** create, edit, complete, and archive projects. The active project is visible and selectable; an account without available assignments receives an access-pending screen.
- **Activity & Audit:** attributable administrative changes and before/after values. Physical stock transactions and descriptive material corrections also write protected audit records.
- **Search and work inbox:** project-scoped materials, receipts, purchase orders, shipments and QR results link to readable record pages. Office users can assign exception owners/dates, keep an item open on hold, or close it after release/return.
- **Field reliability:** account/project-specific drafts, caches and queues; stable submission IDs; atomic receiving, transfer, issue and shipment; accepted quantity for partial deliveries; retained photos with repeatable upload paths; a visible retry screen; corrected admin fields and role gates.
- **Web startup:** server rendering does not touch browser storage; Expo transforms the `import.meta` used by Zustand middleware. The production web export succeeds.

## Verification completed

| Layer | Evidence |
|---|---|
| MSR JavaScript | 15 Node test entries pass, including URL cleanup/recovery, project initialization/account switching, and deferred dashboard startup. Existing source-contract tests are retained alongside behavioral tests. |
| Admin Edge Function | 30 Deno tests pass: real handler authorization, role/status denials, transactional request contract, HTTP conflict handling, filters, invitation state transitions. No network permission is granted to these tests. |
| Field logic | 26 Node tests pass against real TypeScript modules and real Zustand persistence where relevant. Coverage includes draft restoration, account/project isolation, stable retries, upload/reference errors, and account changes during asynchronous photo operations. |
| Database | Ten SQL integration suites run against disposable PostgreSQL 17 with Supabase-compatible auth/storage roles and fixtures. They exercise RLS, storage restrictions, rollback, invitation acceptance, exceptions, corrections, audit and operation idempotency. |
| Concurrency | Separate PostgreSQL connections demonstrably block each other: concurrent self-demotions retain an admin, competing issues cannot overdraw stock, duplicate operations deduct once. |
| Build | Field `npm run lint` and production exports for iOS, Android, and web pass (35 generated web routes). Deno typecheck and whitespace checks pass. |
| Browser | Real MSR page scripts with a fixture backend: invite, edit, role filter, resend, cancel, project creation, audit, search-to-record navigation, exception ownership/date/hold, unauthorized admin redirect, and no-project redirect. Checked desktop and 390px phone layout, including navigation and internal table scrolling. Field login starts without console errors. |

The browser fixture validates UI wiring, not Supabase delivery or RLS. The PostgreSQL harness validates SQL, not hosted Supabase's complete Auth/Storage implementation. These checks complement each other; they do not replace release smoke tests.

## Rollout sequence

1. **Coordinate both applications.** Stop operational writes during the migration/release window and require old Field builds to update. Existing mobile clients use unsafe direct writes that 013 intentionally denies. Record database backup and both prior deployment IDs.
2. **Confirm the shared database baseline.** Field owns historical migrations 001-011; MSR owns 012-017. Do not independently push the two migration directories into the same database. Inspect migration history before applying only missing migrations. The historical fresh-install dependency (011 definitions before 010 policies) is reproduced explicitly in `tests/database/run.sh`.
3. **Inspect data.** Run `supabase/release-preflight.sql` after confirming baseline 012. Resolve missing administrator access/memberships, duplicate photo paths, and legacy path differences with a reviewed data migration. Preserve original data. Legacy unconfirmed invitations become pending/expired in 013 and need a new link.
4. **Apply the missing migrations through 017 in order.** Each new migration is transactional. Confirm reporting views use caller permissions, the photo bucket is private, inactive accounts cannot read project data, and the legacy quantity function is no longer executable by browser roles.
5. **Deploy `admin-users`.** Use Supabase's server-side service credential in the function environment. The function verifies the caller with Auth and rechecks the administrator in transactional RPCs. Configure `INVITATION_TTL_SECONDS` to match the hosted Auth email-link expiry (default 3600 seconds), and allow the production `/login.html` and `/login.html?setup=invite` redirect URLs. Configure the actual mail provider and invitation/password-recovery templates.
6. **Publish MSR and the compatible Field update.** MSR builds browser assets with `node scripts/build-site.mjs` and publishes `dist/`. Database scripts, spreadsheets, and source installation JSON are excluded. Load installation datasets from the project-protected `installation_datasets` table. The Field Netlify site publishes documentation; distribute the app through EAS production updates with the production environment, runtime `1.0.0`, from a clean checkout. No native dependencies or configuration change in this release.

   **Publish checks:** Changed browser assets use September 8/9 cache versions; the dashboard startup fix uses `dashboard.js?v=20260909b`. Confirm that `/user-admin.html`, `/projects.html`, `/audit.html`, `/search.html`, `/work-inbox.html`, and `/record.html` serve the new release. Check all integrations use server credentials for server-owned sync tables.
7. **Smoke-test with designated accounts.** Invite and accept one new account; expire/resend/cancel another; test administrator, office, field and inactive access. Submit partial receiving with photos, retry an interrupted request, and verify one receipt/history entry. On a physical device, test offline camera photos across force-close/reopen, account/project switching, reconnect, and sync retry. Confirm a completed project remains readable and an archived project cannot be operated.

Keep the database permissions and operation RPCs in place when rolling a frontend forward to repair a defect. Reverting to an old client while retaining new permissions stops old writes; reversing the new permission migration would reopen known access vulnerabilities. Restore a backup only as a separately reviewed data-recovery action with an explicit treatment of records created since that backup.

## Practical limits and retained data

- Invitations depend on hosted Auth settings and email delivery. Resend SMTP and actual recovery-email delivery were verified on September 9; a new user's invitation acceptance remains a separate onboarding check. Cancelled invitations remain blocked; accepted inactive users can be reactivated by an administrator.
- Native photos are copied to the app's document directory; web photos are stored as data URLs. Device/browser storage quotas still apply. Queue persistence must succeed before the receiving draft resets. Do not clear app storage while submissions remain pending.
- Legacy queue/draft data without account/project context is retained and never replayed under a guessed identity. A site administrator must review the original device to recover it. Successfully uploaded native photo files are retained rather than deleted automatically.
- MSR receiving preserves a stable request while the page remains open and warns before leaving unsaved work. Offline queueing and restartable drafts are provided by Field; the MSR wizard is not a second offline client.
- Descriptive material corrections require an administrator and a reason. Quantities and physical history are changed through receiving/issue/shipment/transfer operations. Data Browser does not offer arbitrary history deletion.
- Existing icon, theme/layout, app configuration, build configuration and Card changes that were already in the Field working tree are preserved. They are not part of this feature's commits.

## Repeatable checks

From MSR:

```sh
node --test tests/*.test.js
deno test --allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY,INVITATION_TTL_SECONDS,INVITATION_EMAIL_ENABLED tests/admin-users-handler.test.ts tests/admin-users-validation.test.ts
deno check supabase/functions/admin-users/index.ts
bash tests/database/run.sh
python3 tests/browser/serve.py
```

The fixture server listens locally on port 8092; open `http://localhost:8092/user-admin.html`. It substitutes only the Supabase boundary and preserves actual page scripts/styles. Changes are stored in that tab's session storage. It cannot send mail or mutate production. `fixtureRole` and `fixtureNoProjects` session-storage values can exercise access gates.

From Field:

```sh
node --test tests/*.test.cjs
npm run lint
npx expo export --platform web
```


## Production release preparation — September 9, 2026

- Confirmed Supabase project `lzroduricxyshgyjdkki` (`InventoryApp_w_MSR`) was at migration 011, with four existing profiles, three administrators, and project memberships for every profile. No legacy photos or duplicate paths required repair.
- Created and verified a fresh logical backup outside the repositories and recorded completed physical backup `1624336910` from September 9. Previous Netlify deployment IDs and the embedded EAS build are recorded with the backup.
- Rehearsed migrations 012–017 and the legacy installation-data import in one rollback-only transaction against the actual schema. Three administrators remained active, both datasets loaded, and the inspection-photo bucket was private.
- Migration 016 creates the previously missing private inspection-photo bucket. Migration 017 protects installation snapshots by project; the existing legacy data belongs to the configured default project `00000000-0000-0000-0000-000000000000`.
- The Supabase admin function verifies users with Auth and enforces active, accepted administrator access. Its deployed gateway JWT verification is explicitly enabled in `supabase/config.toml`; an existing ES256 session reached the function successfully.
- Corrected Auth's localhost site URL and empty redirect allowlist to the production MSR site and both login/invitation callbacks. The hosted email expiry is 3600 seconds, matching `INVITATION_TTL_SECONDS`.
- At initial publication, Resend was not connected and `INVITATION_EMAIL_ENABLED=false` blocked invite/resend requests before account or access mutations. The subsequent SMTP setup and delivery verification are recorded below. Do not send test emails without an explicitly designated recipient.
- Fresh isolated dependencies resolved a quarantined local Hermes compiler. Committed Field code successfully exported iOS, Android, and all 35 web routes with the EAS production Supabase environment. Original uncommitted icons, theme, and build configuration remain outside the release.
- User priority: MSR dashboard and PO feedback first; review Field last. The exact intended PO-feedback workflow is still awaiting clarification.

The static installation snapshots and older workbooks are still present in Git history and may exist in historical deployments. Excluding them from the current website does not erase those historical copies. Repository cleanup remains deferred.

## Production publication — September 9, 2026

- Merged and pushed both applications to GitHub `main`: MSR release `752437c1acf58ef64258ac44ca1ea272c4067407` and Field `a3515a24a4c976b6afb6b17aadb95b71da17d9dd`. The subsequent dashboard startup fix waits for the Auth/project guard before starting subscriptions; its two regression cases failed before the fix and pass afterward.
- Applied migrations 012–017 and imported both legacy installation snapshots in one transaction. Verified migration history, three preserved active administrators, two project-protected datasets, caller-permission reporting views, a private inspection bucket, and denied browser writes to users and installation snapshots.
- Published `admin-users` version 3 with gateway JWT verification enabled. Authenticated directory, project, and audit reads returned successfully. The live Users & Access page shows all four existing users and the email-configuration notice without console errors.
- Published the MSR site at `https://invenio-field-msr.netlify.app` (initial production deploy `6aa1599f66089c0ebb29e187`). All six new administration/workflow routes return HTTP 200; installation JSON, environment files, and backend/documentation paths return HTTP 404. The backup release record tracks subsequent deployment IDs.
- Published Field update group `2b3b0f24-1a2f-4e48-b713-ff3ddb3b5e4f` to EAS branch/channel `production`, runtime `1.0.0`, for both iOS and Android. This makes the update available to compatible installed builds; device uptake and physical offline/photo workflows remain unverified. No new native binary or App Store submission was made.
- The Field documentation site also deployed from `a3515a2` (Netlify deployment `6aa159a07cb2e0000855768c`). It remains a documentation site, separate from app distribution.
- At initial publication, email onboarding awaited Resend/SMTP configuration. See the subsequent verification below. Prioritize MSR feedback; review the Field experience last.

## Resend email setup — September 9, 2026

- Connected Resend to the **Invenio** Supabase organization, selecting only project `InventoryApp_w_MSR` (`lzroduricxyshgyjdkki`) in the configuration wizard. The user approved the organization's Auth/Projects read-write authorization.
- Linked the existing verified domain `unleashingflow.com` and created the integration credential through Resend. Supabase Auth now uses `smtp.resend.com:465`, username `resend`, and sender **Invenio <no-reply@unleashingflow.com>**. The credential remains in the hosted integration; no secret was added to app source or browser assets.
- Verified the existing production login/invitation redirect allowlist and 3600-second link expiry. The wizard set the hosted email limit to 25 per hour. The Send Email hook remains disabled because SMTP handles delivery.
- Supabase's actual password-recovery request returned HTTP 200; Resend reported delivery and the message appeared in the designated Gmail mailbox. No password was changed and no test user or project assignment was created.
- A separate plain delivery test reached both user-approved addresses. The UnleashingFlow mailbox received it in Inbox with SPF, DKIM, and DMARC passing. Gmail initially classified the first recovery and delivery-test messages as spam; those specific legitimate tests were corrected and moved to Inbox. This does not establish inbox placement for other recipients.
- Set `INVITATION_EMAIL_ENABLED=true` and verified that the live **Invite User** button is enabled and the email-configuration notice is gone. End-to-end acceptance by a newly invited user remains untested.
- Kept an unpublished Resend draft, **Invenio delivery verification**, for future designated-recipient diagnostics. It is separate from Supabase's Auth templates and is not used for production authentication messages.

Configuration references: [Resend's Supabase SMTP guide](https://resend.com/docs/send-with-supabase-smtp) and [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
