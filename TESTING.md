# Test Plan — Invenio Field Platform

A full-system regression suite for the MSR dashboard, the Field mobile app, and the shared Supabase backend. Designed to be run before any release, after any migration, and especially as a baseline before/after the repo merge into a monorepo.

**Scope:** end-to-end behavior of both apps and the data they share. Visual-only regression of the design-system restyle is covered separately by [`UAT.md`](UAT.md) — that doc is narrower; this one is broader.

**Time:** 10 min for smoke (§1), ~60 min for full regression (§1–§7), ~90 min including Field app (§6).

**Audience:** anyone with admin access to project `lzroduricxyshgyjdkki`.

---

## Legend

- 🤖 **Automatable** — covered or coverable by `tests/*.js` or Playwright
- 👤 **One human** — visual judgment / browser interaction
- 👥 **Multiple sessions** — needs a second tab, second device, or a second user
- 🔧 **API probe** — `curl` against PostgREST or the auth admin API
- ⚠️ **Risk-flagged** — recently changed area, watch closely

---

## 0. Pre-test setup

### Accounts
- [ ] Admin account with a real (non-`@example.com`) email — the demo `@example.com` users cannot reset their passwords via Supabase email validation.
- [ ] Account is in `auth.users`, has a row in `public.users` with `role = 'admin'`, and a row in `public.user_projects` for the default project `00000000-0000-0000-0000-000000000000`. This is what the auth flow expects post-migration 011.

### Tools
- [ ] DevTools open on the Console tab — surfaces any JS/network errors.
- [ ] Anon key from `supabase-config.js` and (optionally) service-role key from `supabase projects api-keys --project-ref lzroduricxyshgyjdkki` for §4 DB integrity probes.
- [ ] Two browser tabs (or two devices) for the realtime tests in §3.

### Known clean-state expectations
Recorded post-migration 011 so you can confirm baseline before testing:

| Table | Rows | Notes |
|---|---|---|
| `purchase_orders` | 800 | Project ID = default for all |
| `shipments` | 127 | Includes 5 logistics columns from `inventory_schema.sql` |
| `dashboard_metrics` | 1 | Single-row metrics cache |
| `material_links` | 2 | Demo data |
| `material_status_history` | 0 | Audit table — populated by trigger on `material_links` updates |
| `samsara_trackers` | 40 | Synced from Samsara API |
| `samsara_location_history` | 0 | Empty |
| `delivery_dates` | 80 | |
| `project_schedule` | 118 | Seeded via `supabase/seed_project_schedule.sql` |
| `inventory_records` | 0 | Project-scoped, empty until seeded |
| `shop_contacts` | 0 | **Intentionally unscoped** (vendor reference data) |
| `outside_shop_inventory` | 0 | Project-scoped, empty |

If counts diverge significantly, investigate before proceeding — something else has changed the data.

---

## §1 Smoke tests — 5 min

Quick "nothing is on fire" sweep. Run after every deploy.

| ID | Page | What to check | Tag |
|---|---|---|---|
| SMOKE-01 | `login.html` | Loads cleanly, no console errors. "Forgot password?" link visible. | 👤 |
| SMOKE-02 | `index.html` (dashboard) | KPI cards render, doughnut chart populates, no `undefined` in any metric. | 👤 ⚠️ |
| SMOKE-03 | `project-schedule.html` | Table view shows 118 activities. Switch to Timeline view — bars render, "TODAY" line aligns with bar start (no 50px offset). | 👤 ⚠️ |
| SMOKE-04 | `samsara-tracking.html` | Map shows tracker pins, list shows 40 trackers, stats panel shows numbers (per-project — view changed in 011). | 👤 ⚠️ |
| SMOKE-05 | `material-tracking.html` | Link list loads, no errors. | 👤 |
| SMOKE-06 | `receiving.html` | Wizard initializes (camera permission prompt OK). | 👤 |
| SMOKE-07 | `delivery-dates.html` | 80 dates listed, sortable. | 👤 |
| SMOKE-08 | `inventory.html` | Loads (empty state expected — table has 0 rows). | 👤 |
| SMOKE-09 | `outside-shop-inventory.html` | Loads (empty state expected). | 👤 |
| SMOKE-10 | `shop-contacts.html` | Loads (empty state expected). | 👤 |
| SMOKE-11 | `shipment-visibility.html` | Loads, shipments listed. | 👤 |
| SMOKE-12 | `gap-analysis.html` | Renders charts. | 👤 |
| SMOKE-13 | `site-plan.html` | Static SVG renders (no Supabase dependency). | 👤 |
| SMOKE-14 | `admin.html` | Table picker shows ≥13 tables. | 👤 |

**Pass criteria:** no JS console errors on any page, all pages render their primary content.

---

## §2 Authentication & session

| ID | Test | Steps | Expected | Tag |
|---|---|---|---|---|
| AUTH-01 | Sign-in with valid creds | Enter admin email + password on `login.html`. | Redirect to `index.html`, session stored, no console errors. | 👤 |
| AUTH-02 | Sign-in with bad password | Enter wrong password. | Form shows error, stays on `login.html`. | 👤 |
| AUTH-03 | Sign-in with `@example.com` | Try `admin@example.com` in the reset form. | Supabase rejects with "Email address invalid" (this is correct; document for your team). | 👤 |
| AUTH-04 | Forgot password (real email) | Click "Forgot password?", enter your real email, submit. | Confirmation message shows. Email arrives within ~1 min in inbox or spam. From: `noreply@mail.app.supabase.io`. | 👤 ⚠️ |
| AUTH-05 | Password reset link → set new password | Click the link in the email. | Lands on `login.html` with the password-set form (NOT auto-redirected to dashboard). New password validates and works for sign-in. | 👤 ⚠️ |
| AUTH-06 | Forgot password (non-existent email) | Submit a real-domain email that isn't registered. | Same success-looking confirmation (security feature — no enumeration). No actual email sent. | 👤 |
| AUTH-07 | Sign-out | Click sign-out from any protected page. | Redirect to `login.html`, session cleared. | 👤 |
| AUTH-08 | Protected pages without session | Open any protected page in an incognito window. | Auto-redirect to `login.html`. | 👤 |
| AUTH-09 | `tests/login-reset.test.js` | `node tests/login-reset.test.js`. | All assertions pass. | 🤖 |

**Known limit:** Supabase's default SMTP is rate-limited to 4 emails/hour. Three failed AUTH-04 attempts will rate-limit you for the rest of the hour.

---

## §3 Multi-tenant project scoping

Validates migration 011 + `project-scope.js` end-to-end. The dashboard should never read or write rows outside the active project.

| ID | Test | Steps | Expected | Tag |
|---|---|---|---|---|
| SCOPE-01 | `tests/project-scope.test.js` | `node tests/project-scope.test.js`. | All assertions pass. | 🤖 |
| SCOPE-02 | Insert via admin auto-injects `project_id` | In `admin.html`, pick `inventory_records` (after adding to picker per §5-ADMIN-EXTRAS). Create a new row leaving `project_id` unset. | Insert succeeds. Probe via API confirms the row landed with the active project's ID. | 👤 🔧 |
| SCOPE-03 | Realtime filter | Two tabs of `index.html`. In tab A, edit a `purchase_orders.status` via `admin.html`. | Tab B's KPI panel updates within ~2s. The realtime subscription is project-filtered (see `dashboard.js:46`). | 👥 ⚠️ |
| SCOPE-04 | Cross-project leak (negative test) | Use service-role API to insert one `inventory_record` with `project_id = '11111111-1111-1111-1111-111111111111'`. Reload `inventory.html`. | The cross-project row does NOT appear. (Cleanup: delete the test row.) | 🔧 ⚠️ |
| SCOPE-05 | `inspection_photos` workaround | Receive an item via `receiving.html`, attach a photo. | Photo uploads. Linked through `receiving_records.project_id` (the table itself doesn't have `project_id` — by design). | 👤 |
| SCOPE-06 | `audit_log` workaround | Trigger any action that writes to `audit_log` (e.g., status change). | Row written with `details.project_id` populated (the column itself doesn't have project_id; the value lives in the JSON `details` field — by design). | 🔧 |
| SCOPE-07 | `shop_contacts` is unscoped | Probe `shop_contacts` via API as anon. | Returns rows regardless of project — this is intentional (vendor reference data shared across projects). | 🔧 |

**API probe template** (substitute anon key):
```bash
curl -s "https://lzroduricxyshgyjdkki.supabase.co/rest/v1/<table>?select=*&limit=5" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

---

## §4 Database integrity

Validates migration 011's triggers, views, and FKs. Mostly 🔧 API probes.

| ID | Test | How to verify | Expected | Tag |
|---|---|---|---|---|
| DB-01 | All 12 MSR tables exist | `for t in purchase_orders shipments dashboard_metrics material_links material_status_history samsara_trackers samsara_location_history delivery_dates project_schedule inventory_records shop_contacts outside_shop_inventory; do curl … count; done` | All return 200 with non-error counts. | 🔧 |
| DB-02 | `updated_at` trigger fires | PATCH any record's editable field via service-role API. | `updated_at` increments to NOW on the same response. | 🔧 ⚠️ |
| DB-03 | `track_material_status_change` trigger | UPDATE `material_links.material_status` to a different value. | New row appears in `material_status_history` with `project_id` populated (NEW behavior post-011). | 🔧 ⚠️ |
| DB-04 | `vw_active_samsara_trackers` works | GET `/rest/v1/vw_active_samsara_trackers?limit=5`. | Returns rows including `project_id` column (added in 011). | 🔧 |
| DB-05 | `vw_samsara_tracker_stats` is per-project | GET `/rest/v1/vw_samsara_tracker_stats`. | Returns one row per project (≥1). Used to be a single global aggregate; per-project is the new behavior. | 🔧 ⚠️ |
| DB-06 | All other views are queryable | GET each: `vw_recent_activity`, `vw_material_links_detailed`, `vw_stats_by_discipline`, `vw_stats_by_status`, `vw_delivery_dates_with_po`, `vw_upcoming_delivery_dates`, `vw_milestones`, `vw_upcoming_activities`, `vw_critical_activities`, `vw_activities_by_type`, `vw_outside_shop_details`, `vw_shipment_visibility`, `vw_po_summary`, `vw_shipment_summary`. | 200 OK with valid JSON. | 🔧 |
| DB-07 | `project_id NOT NULL` on inventory tables | Try INSERT without project_id via service-role on `inventory_records`. | Rejected with `null value in column "project_id"` constraint violation. | 🔧 |
| DB-08 | Default project FK exists | `select * from public.projects where id = '00000000-0000-0000-0000-000000000000'`. | Returns one row. (Required for FK validity on all `project_id` columns.) | 🔧 |
| DB-09 | Migration history matches local | `supabase migration list` from `Invenio Field/`. | All Local rows have a Remote counterpart. | 🤖 |
| DB-10 | Orphaned MSR functions are dropped | Probe `pg_proc` for `update_po_timestamp`, `update_shipment_timestamp`, etc. | Should NOT exist (dropped by 011). | 🔧 |

---

## §5 Page-by-page functional tests

### Dashboard (`index.html`)
- [ ] **DASH-01** All four KPI cards show non-`undefined` numbers. 👤
- [ ] **DASH-02** Status doughnut chart renders with the 4 PO statuses (Sent / Follow-Up Document Created / Finished / Canceled) — colors match. 👤
- [ ] **DASH-03** Realtime: edit a PO status in admin, watch the doughnut update without refresh. 👥
- [ ] **DASH-04** Recent activity panel scrolls; clicking a row navigates somewhere sensible (or no-op without error). 👤

### Project Schedule (`project-schedule.html`)
- [ ] **SCHED-01** Table view: 118 activities, filterable by category, sortable by date. 👤
- [ ] **SCHED-02** Timeline view (post-`8c3cb61`): TODAY line aligns with bar start. 👤 ⚠️
- [ ] **SCHED-03** Timeline view in **dark mode**: row tints (in-progress blue, critical red, milestone green) are readable; legend background uses surface token. 👤 ⚠️
- [ ] **SCHED-04** Light/dark toggle while on Timeline view: no flash of unstyled content, all colors swap correctly. 👤
- [ ] **SCHED-05** Scrolling horizontally: month markers stay aligned with the timeline width. 👤
- [ ] **SCHED-06** Filter to "Other" category: timeline correctly shows "no activities in window" empty state. 👤

### Samsara (`samsara-tracking.html`)
- [ ] **SAM-01** Map shows pins for all 40 trackers with positions. 👤
- [ ] **SAM-02** Stats panel matches per-project counts (active 24h / on-site / in-transit). 👤 ⚠️
- [ ] **SAM-03** Stale-tracker filter (>7d) works. 👤
- [ ] **SAM-04** Linked-material column shows PO/install_tag for trackers with `linked_material_id`. 👤

### Material Tracking (`material-tracking.html`)
- [ ] **MAT-01** Link list loads (2 demo rows). 👤
- [ ] **MAT-02** Filter by discipline works. 👤
- [ ] **MAT-03** Edit a link's status: confirm the audit row appears in `material_status_history` with `project_id` populated (cross-ref DB-03). 👤 🔧

### Receiving (`receiving.html`)
- [ ] **RCV-01** Wizard launches; first step accepts a QR scan or manual entry. 👤
- [ ] **RCV-02** Photo upload step succeeds; photo URL stored in `inspection_photos`. 👤
- [ ] **RCV-03** Submit creates `receiving_records` row with `project_id` injected (cross-ref SCOPE-05). 👤 🔧

### Delivery Dates (`delivery-dates.html`)
- [ ] **DEL-01** 80 rows visible, sortable by date. 👤
- [ ] **DEL-02** Upcoming-30-day filter narrows correctly. 👤

### Admin (`admin.html`)
- [ ] **ADMIN-01** Table picker lists ≥13 tables. 👤
- [ ] **ADMIN-02** Edit a PO: status field is a **dropdown** (not free-text) with the 4 known values; saves successfully. 👤 ⚠️ (post-`bf4f79f`)
- [ ] **ADMIN-03** Edit a PO: `delivery_status`, `delivery_date_from`, `category`, `sub_category`, `item_status` are editable in the modal but hidden from the row table. 👤 ⚠️
- [ ] **ADMIN-04** CSV export of POs includes ALL columns including the modal-only ones. 👤
- [ ] **ADMIN-EXTRAS** (after we add them) `material_status_history`, `inventory_records`, `outside_shop_inventory`, `shop_contacts` show in the picker. 👤

### Site Plan (`site-plan.html`)
- [ ] **PLAN-01** Static SVG renders; no Supabase calls (verify via Network tab). 👤
- [ ] **PLAN-02** Hover tooltips and zone selection work. 👤

### Gap Analysis (`gap-analysis.html`)
- [ ] **GAP-01** Charts render; data quality indicators populate. 👤

---

## §6 Field mobile app

⚠️ Currently mostly TBD — Field-side regression depends on:
- The password reset port (mirroring MSR's `965f5b0`)
- The `locations.tsx` scoping fix (`322aac0`) being verified in a running app

| ID | Test | Steps | Expected | Tag |
|---|---|---|---|---|
| MOBILE-01 | `npm run lint` (Field) | From `Invenio Field/`, run `npm run lint`. | `typecheck` + `tokens-lint` both pass. | 🤖 |
| MOBILE-02 | Sign in via Expo dev client | `npm run dev`, sign in with admin creds. | Land on dashboard route, project selector shows default project. | 👤 |
| MOBILE-03 | Locations create | `(office)/locations`, "Add Location", fill zone/row/rack, save. | Row appears in list. Probe `locations` table — confirm `project_id` is set (post-`322aac0` fix). | 👤 🔧 ⚠️ |
| MOBILE-04 | Field-side password reset | After porting from MSR. | Email arrives, link opens app via deep link, password resets. | 👤 ⚠️ |
| MOBILE-05 | Project switching | Switch active project in selector. | All scoped queries re-fetch for the new project. | 👤 |
| MOBILE-06 | QR scan + receive | Scan a QR, run through receive wizard. | `receiving_records` row created, photo uploaded. | 👤 |
| MOBILE-07 | Offline → reconnect | Disable network, attempt an action, reconnect. | Action queues or surfaces appropriate error. | 👤 |

---

## §7 Automated tests — full list

```bash
# MSR — Node-based assertion tests
node tests/login-reset.test.js
node tests/project-scope.test.js

# Field — typecheck + tokens lint
cd "../Invenio Field" && npm run lint
```

All four should pass. CI (when wired) should run these on every PR.

---

## §8 Pre/post-merge regression

Run §1 + §3 + §4 immediately before starting the monorepo merge. Save the timestamps + any flagged issues. Run again after the merge lands and compare. Differences indicate merge-introduced regressions.

Suggested artifact to commit alongside:
```
docs/test-runs/<YYYY-MM-DD>-pre-merge.md
docs/test-runs/<YYYY-MM-DD>-post-merge.md
```

---

## Known issues / gotchas (current state)

- **Demo `@example.com` users can't reset passwords.** Supabase rejects the domain at API validation. Use a real-email account for AUTH-04/05.
- **Password reset email rate limit.** Default Supabase SMTP allows 4/hr. Set up a custom SMTP if you need higher throughput.
- **`sync_samsara_data.py` reads `vw_samsara_tracker_stats[0]`** — that worked when the view was a single global row, but since migration 011 it's per-project. The script needs an update before it's safely re-run; flagged as follow-up, not part of 011.
- **`tests/` are minimal.** Just two assertion-style scripts. Building out a Playwright/Cypress suite is the natural next step for SMOKE-01..14 and DASH-01..04.
- **No CI yet.** The `.github/workflows/sync-samsara.yml` covers data sync, not test runs. Wire `node tests/*.js` + `npm run lint` into a workflow before the merge if possible.

---

## References

- [`UAT.md`](UAT.md) — design-system restyle visual UAT (narrower scope)
- [`supabase/migrations/011_msr_table_definitions.sql`](../Invenio Field/supabase/migrations/011_msr_table_definitions.sql) — Field repo, codifies MSR-owned tables
- [`js/utils/project-scope.js`](js/utils/project-scope.js) — multi-tenant scoping helper
- [`js/utils/auth-guard.js`](js/utils/auth-guard.js) — session check on protected pages
- [`login.html`](login.html) — auth flow incl. password reset
- [`Invenio Field/lib/supabaseProject.ts`](../Invenio Field/lib/supabaseProject.ts) — mobile-side scoping wrapper
