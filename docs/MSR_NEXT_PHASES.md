# MSR improvement phases

September 9, 2026. Continue MSR improvements after the administration and email release. Leave the additional email account unchanged and review Field last.

## Phase 1 — Correct records and safe refreshes (completed)

1. **Material and project labels (small).** Read PO line identifiers from `purchase_order_item`, prefer `item_description` with `po_description` as fallback, and use the selected project for the dashboard heading. Filtered PO/installation selections must retain the exact clicked record; imported descriptions render as text. Verify schema-shaped records and switching projects with behavioral tests and a browser fixture.
2. **Atomic workbook import (medium).** Validate both sheets before writing; require an explicit project and a server-only credential. Import both tables and recompute procurement metrics in one database transaction. Match PO records by project/PO/line and shipments by their existing unique shipment number, rejecting another project's collision. Preserve IDs, absent records, installation metrics, and operational history. Reject ambiguous duplicates, invalid values, empty sheets, and inactive projects. Default CLI behavior is validation only; `--apply` submits. Verify real PostgreSQL rollback, repeat imports, role denial, and isolation, plus generated workbook tests.
3. **Honest dashboard freshness (medium).** Separate the realtime connection label from source timestamps. Show procurement import, installation snapshot, and GPS freshness with an explicit 24-hour review threshold. Missing data, stale data, future timestamps, and query errors must remain distinguishable. Load paginated PO/shipment records and derive procurement counts from the records actually shown. Verify stale/empty/error states and a narrow browser viewport.

### Import contract

`public.import_po_shipment_snapshot(p_project_id uuid, p_purchase_orders jsonb, p_shipments jsonb)` is executable only by `service_role`. Each array contains 1–10,000 allowlisted records using existing table column names; the server supplies project, IDs, and timestamps. Successful response contains `purchase_orders`, `shipments`, and `synced_at`. It never deletes absent rows. All validations, upserts, and metric changes commit or roll back together. PostgreSQL serializes imports per project, and unique constraints protect stable identifiers. The existing globally unique shipment identifier remains in force; cross-project collisions fail safely.

Install the CLI dependencies with `python3 -m pip install -r requirements-import.txt` in a virtual environment. `python3 sync_po_shipment_data.py --file <workbook> --project-id <uuid>` validates without contacting Supabase. Add `--apply` only for an intended import; the server URL must use HTTPS and `SUPABASE_SERVICE_ROLE_KEY` must be supplied outside source control. The legacy anonymous-key/delete-and-reinsert path is removed. There is no unattended import schedule in this phase. Missing optional columns preserve existing fields; explicit blank cells clear the matching optional field. Recalculate and save formula cells before importing; spreadsheet errors and missing formula results are rejected.

### Checkpoint

- Regression tests fail on the original display behavior and pass with the correction.
- Invalid or interrupted imports leave the previous records and metrics intact; repeating an import preserves record IDs and counts.
- JavaScript, Python, PostgreSQL, build, and browser checks pass. Record the migration/deployment state separately from local completion.
- A production data import requires a current, validated workbook. The existing local workbook contains duplicate shipment identifiers and is not silently deduplicated or imported.

## Phase 2 — Dashboard decisions

Bring existing Work Inbox exceptions, owners, due dates, and overdue work onto the dashboard; add upcoming arrivals and direct links to the underlying records. Align the shared PDF export's project labeling and pagination with the dashboard (the older shared export still prefers branding labels and fetches a single page). Verify counts against the inbox and selected project, including empty states. Use that release for stakeholder feedback before defining additional approval or purchase-order feedback workflows; the earlier meaning of “PO feedback” is still unspecified.

## Phase 3 — Repeatable releases

Run the existing JavaScript, Deno, Python, and database checks in CI, enforce a safe publish build, and add a deployment smoke test. Make each external sync's operating repository, credential, schedule, and failure owner explicit before retiring old repositories. Complete new-user invitation acceptance with a designated real user when needed; email delivery is already verified.

## Phase 4 — Field review

Verify uptake of the published update on a physical device, then test receiving with photos offline, force-close/reopen, reconnect/retry, account/project switching, and duplicate prevention. Prioritize interface changes from those observed workflows.

## Implementation references

- [Supabase database functions](https://supabase.com/docs/guides/database/functions): function access, fixed search paths, and explicit execution grants.
- [PostgREST transactions](https://docs.postgrest.org/en/stable/references/transactions.html): a request runs in a transaction and database failures roll it back.
- [PostgreSQL JSON functions](https://www.postgresql.org/docs/current/functions-json.html): typed JSON record conversion.

## Verification record

Local implementation completed on `feature/msr-data-reliability`:

- 25 JavaScript test entries pass, including independent failing-before/fixed-after display and filtered-selection regressions, data-age handling, pagination, and the private publication boundary.
- 15 generated-workbook/CLI tests pass, with no live HTTP calls.
- 11 PostgreSQL suites pass in a disposable database. An injected failure after PO/shipment writes proves complete rollback. Five actual concurrent-session checks pass, including serial same-project imports and cross-project shipment collision rollback.
- Real browser checks pass for correct project switching, empty projects, stale versus recent sources, visible query failure, material labels, filtered selection, and a 390px viewport without horizontal overflow. No application JavaScript errors were observed; the local Materials fixture logged an optional `/favicon.ico` 404.
- The current local workbook was not imported. Validation stops at spreadsheet error cell `PO Parts Log!H71`; an independent identifier audit also found repeated shipment identifiers. Source reconciliation remains a prerequisite to importing that workbook.

Release order: verify the live PO natural keys, save the affected tables and constraints outside Git, apply migration 018 with its history record, publish `dist`, and check the live UI. The frontend works before 018 because it reads existing tables; the importer requires 018. Rollback can restore the previous Netlify deployment and, if needed, drop only `import_po_shipment_snapshot(uuid,jsonb,jsonb)` and constraint `purchase_orders_project_po_line_key`. Do not restore the destructive legacy importer or weaken RLS. Migration 018 changes no source records.

Production build configuration correction: the custom `git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF` ignore command cancelled the first production build after a successful preview because the cached preview matched the merged files. Removed that cross-context skip rule so production builds are not suppressed by preview cache state. The verified `dist` build can also be published directly with an explicit MSR site ID.

### Production publication — September 9

- Merged [PR 1](https://github.com/TomEnglish/invenio-tek-msr/pull/1) and pushed the build-configuration correction to `main` (`6922ac8`). The automatic production build succeeded after the correction; verified manual publication `6aa16cb448a933e6da507029` serves the same tested JavaScript.
- Applied migration 018 and its migration-history entry in one transaction. Verified imports are denied to `anon` and `authenticated` and permitted to `service_role`. Saved affected tables/constraints and release evidence outside Git in `_backups/field-platform/2026-09-09-msr-data-release/`.
- Verified live [MSR](https://invenio-field-msr.netlify.app): Main Yard heading, 95 POs, 127 shipments, independent source-age labels, and 800 material lines with actual descriptions. The live Materials page has no console errors. No workbook import or Field change was performed.
- Phase 1 is complete. Phases 2–4 were subsequently implemented as recorded below.

## Phases 2–4 implementation and acceptance

1. Add shared exception/date rules, dashboard totals and the five earliest-due exceptions. Link Open, Mine, Overdue and Unassigned counts to corresponding Work Inbox filters. Show owners/dates/holds, clear empty/error states, and project-scoped arrivals past ETA through today plus seven days. Acceptance: matching inbox counts, date boundaries, selected-project isolation and narrow-screen browser checks.
2. Fix PDF selected-project identity, complete pagination, required-query failure, escaping and synchronous popup reservation. Acceptance: independent regression tests for 1,501 PO lines, 1,201 shipments, malicious text, failures after page one, popup blocking, small currency values and local calendar dates.
3. Add MSR and Field quality workflows, immutable shared-schema baseline, public build manifest and exact-commit deployment smoke. Document integration ownership and prevent the legacy anonymous-key Samsara workflow from appearing usable in the canonical repo. Acceptance: real GitHub Actions runs plus a verified published artifact. No external sync cutover is implied.
4. Review Field last in a clean worktree, protecting existing design/config edits. Exercise queue, drafts, attachment persistence, force-close recovery, reconnect/retry, identity/project changes and idempotency. Fix reproducible defects with failing-before tests; run lint and all-platform bundles. Inspect a physical device if available. Device update uptake, actual camera capture and offline force-close behavior remain explicitly pending until observed on hardware.


## Phases 2–4 release — September 9

- **Phase 2 published:** [MSR PR 2](https://github.com/TomEnglish/invenio-tek-msr/pull/2) merged. The production dashboard shows 3 open/unassigned Main Yard exceptions and 75 pending shipments past ETA; those arrival dates reflect the existing old source data, whose age remains visible. Inbox links, selected-project empty states, explicit source failures and the 390px layout were verified in the browser. PDF regressions pass for complete pagination, selected-project identity, safe rendering and failed-query handling.
- **Phase 3 active:** [MSR quality and production smoke](https://github.com/TomEnglish/invenio-tek-msr/actions/runs/34366875299) passed on `f862ce3`. The smoke verified 12 exact public asset hashes and seven private-path exclusions. Field CI also passed on its [merged release](https://github.com/TomEnglish/invenio-field-platform/actions/runs/34368635080), running 52 tests, lint and iOS/Android/web exports. Integration ownership and deferred cutovers are recorded in `INTEGRATION_OWNERSHIP.md`.
- **Phase 4 fixes published:** [Field PR 2](https://github.com/TomEnglish/invenio-field-platform/pull/2) merged at `422f9ff65acc746662a72ed93a9bd0140a072500`. The production EAS update group is `21db04a8-c496-42d2-aea2-741c737724e1`, runtime `1.0.0`, published at 15:12 UTC. Android update: `01a086ba-399d-7d20-a9b6-caeec9b3ce22`; iOS update: `01a086ba-399d-7a2f-ad80-d1ea1974d044`. Offline access recovery, safe queue draining/retry, photo draft ownership and version diagnostics are included. The production bundle contains the intended shared Supabase endpoint and no CI placeholder key.
- **Device acceptance remains open:** the iPhone was unavailable. Actual update uptake, camera capture, airplane-mode force-close/reopen and hardware reconnect behavior must still follow Field's `docs/FIELD_RECOVERY_REVIEW.md`. Publication and automated/browser checks do not establish hardware acceptance.
- **Existing work preserved:** the original Field design/config patch was unchanged byte-for-byte after updating the local checkout. No workbook import, external sync cutover, additional user account or invitation was performed.
