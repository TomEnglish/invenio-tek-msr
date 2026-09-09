# MSR improvement phases

September 9, 2026. Continue MSR improvements after the administration and email release. Leave the additional email account unchanged and review Field last.

## Phase 1 — Correct records and safe refreshes (current implementation)

1. **Material and project labels (small).** Read PO line identifiers from `purchase_order_item`, prefer `item_description` with `po_description` as fallback, and use the selected project for the dashboard heading. Verify schema-shaped records and switching projects with behavioral tests and a browser fixture.
2. **Atomic workbook import (medium).** Validate both sheets before writing; require an explicit project and a server-only credential. Import both tables and recompute procurement metrics in one database transaction. Match PO records by project/PO/line and shipments by their existing unique shipment number, rejecting another project's collision. Preserve IDs, absent records, installation metrics, and operational history. Reject ambiguous duplicates, invalid values, empty sheets, and inactive projects. Default CLI behavior is validation only; `--apply` submits. Verify real PostgreSQL rollback, repeat imports, role denial, and isolation, plus generated workbook tests.
3. **Honest dashboard freshness (medium).** Separate the realtime connection label from source timestamps. Show procurement import, installation snapshot, and GPS freshness with an explicit 24-hour review threshold. Missing data, stale data, future timestamps, and query errors must remain distinguishable. Load paginated PO/shipment records and derive procurement counts from the records actually shown. Verify stale/empty/error states and a narrow browser viewport.

### Import contract

`public.import_po_shipment_snapshot(p_project_id uuid, p_purchase_orders jsonb, p_shipments jsonb)` is executable only by `service_role`. Each array contains 1–10,000 allowlisted records using existing table column names; the server supplies project, IDs, and timestamps. Successful response contains `purchase_orders`, `shipments`, and `synced_at`. It never deletes absent rows. All validations, upserts, and metric changes commit or roll back together. PostgreSQL serializes imports per project, and unique constraints protect stable identifiers. The existing globally unique shipment identifier remains in force; cross-project collisions fail safely.

`python3 sync_po_shipment_data.py --file <workbook> --project-id <uuid>` validates without contacting Supabase. Add `--apply` only for an intended import; the server URL must use HTTPS and `SUPABASE_SERVICE_ROLE_KEY` must be supplied outside source control. The legacy anonymous-key/delete-and-reinsert path is removed. There is no unattended import schedule in this phase.

### Checkpoint

- Regression tests fail on the original display behavior and pass with the correction.
- Invalid or interrupted imports leave the previous records and metrics intact; repeating an import preserves record IDs and counts.
- JavaScript, Python, PostgreSQL, build, and browser checks pass. Record the migration/deployment state separately from local completion.
- A production data import requires a current, validated workbook. The existing local workbook contains duplicate shipment identifiers and is not silently deduplicated or imported.

## Phase 2 — Dashboard decisions

Bring existing Work Inbox exceptions, owners, due dates, and overdue work onto the dashboard; add upcoming arrivals and direct links to the underlying records. Verify counts against the inbox and selected project, including empty states. Use that release for stakeholder feedback before defining additional approval or purchase-order feedback workflows; the earlier meaning of “PO feedback” is still unspecified.

## Phase 3 — Repeatable releases

Run the existing JavaScript, Deno, Python, and database checks in CI, enforce a safe publish build, and add a deployment smoke test. Make each external sync's operating repository, credential, schedule, and failure owner explicit before retiring old repositories. Complete new-user invitation acceptance with a designated real user when needed; email delivery is already verified.

## Phase 4 — Field review

Verify uptake of the published update on a physical device, then test receiving with photos offline, force-close/reopen, reconnect/retry, account/project switching, and duplicate prevention. Prioritize interface changes from those observed workflows.

## Implementation references

- [Supabase database functions](https://supabase.com/docs/guides/database/functions): function access, fixed search paths, and explicit execution grants.
- [PostgREST transactions](https://docs.postgrest.org/en/stable/references/transactions.html): a request runs in a transaction and database failures roll it back.
- [PostgreSQL JSON functions](https://www.postgresql.org/docs/current/functions-json.html): typed JSON record conversion.

## Verification record

Implementation and verification in progress on `feature/msr-data-reliability`.
