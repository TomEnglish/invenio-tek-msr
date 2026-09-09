# UI workflow sprint — September 9, 2026

Approved scope: recommendations 1–7 from the interface review. Keep existing project access, decision permissions, transaction semantics, and offline recovery. Preserve the original Field checkout's pending design/config edits by working in a clean worktree.

## Delivery slices

1. **Dashboard and arrivals.** Compact project header; visible source-health summary with expandable details; work and arrivals before KPIs. Default to arrivals today through seven days; separate past/missing ETA confirmation view, with counts and source-age context. Verify date boundaries, empty/error states, and desktop/mobile layouts.
2. **Navigation and language.** Work Inbox follows Dashboard. Use Yard Inventory, PO & Installation, and Delivery Dates to distinguish workflows. Present exception labels and PO identifiers in readable language. Verify navigation and record links.
3. **Work Inbox.** Compact exception list with owner/due/status and one Review action. Accessible dialog/drawer contains inspection context and decision form; preserve changes until save or explicit discard. Save confirms success, handles errors, and respects field-only/completed-project access. Verify open/save/cancel/filter/pagination and keyboard focus.
4. **Record details.** Group material/PO, quantities, delivery/location, inspection/photos, and decisions. Show relevant receiving/inbox links without inventing editing permissions or history. Verify each record type, absent fields, and photo failures.
5. **Mobile user administration.** Keep desktop table; provide expandable cards on narrow screens with the same role/status/projects/invitation actions. Verify filters, pagination, dialogs, empty/error states, and 320px layout.
6. **Field receiving.** Numbered/named progress, final review with editable sections, validation before queueing, and truthful saved/submitted feedback. Preserve draft scope and operation IDs. Verify edit/return/submit and failed persistence; export iOS/Android/web.
7. **Field Sync.** Material/PO descriptions, clear queue status and recovery instructions, technical IDs/errors in expandable support details. Preserve retry/account/project safeguards. Verify queued/failed/offline/empty states.

## Release gates

- Run relevant automated checks after each slice; browser-test changed MSR pages at phone/tablet/desktop sizes with the local fixture backend.
- Run Field tests, lint/typecheck, and all-platform export; use local fixture for receiving/review/Sync. Physical camera and force-close acceptance remains a device check.
- Review the final diff, commit/push both repositories, merge only passing checks, verify MSR deployment and publish Field production update under existing release authorization.
- Update this document with completed checks and release evidence.

## Completed release

All seven items shipped on September 9, 2026.

- **MSR:** [PR #4](https://github.com/TomEnglish/invenio-tek-msr/pull/4) merged at `a86ade400a526240daecfed7b484b36c67da8cb1`. The [production dashboard](https://invenio-field-msr.netlify.app) serves the updated UI. [Main CI](https://github.com/TomEnglish/invenio-tek-msr/actions/runs/34378255008) passed, including the deployed commit, asset and private-path smoke checks.
- **Field:** [PR #3](https://github.com/TomEnglish/invenio-field-platform/pull/3) merged at `0f4ff7c88d92522a48f7d12c3309a173f03c8545`. [Main CI](https://github.com/TomEnglish/invenio-field-platform/actions/runs/34378651300) passed. The production EAS update group is `3465e6a0-728e-49fd-9570-20ef3c4864e0`, published for iOS and Android on runtime `1.0.0`; server metadata matches the merged commit.
- **Automated verification:** MSR's 42 sprint tests and full CI passed. Field's 61 tests, typecheck, design-token lint and iOS/Android/web exports passed. The Field tests exercise real queue persistence failure/retry and stale asynchronous queue reads. Both published native bundles contain the production backend configuration rather than CI placeholders.
- **Browser verification:** MSR dashboard, arrivals, inbox, record links and user administration were checked at phone/tablet/desktop widths, including 320px, keyboard focus, failed staff lookup and drawer save behavior. Field receiving was exercised through review, editing, validation, queueing and failed upload recovery at 390px. Production MSR read-only verification confirmed the separate ETA confirmation view.
- **Review:** Independent code reviews approved both final implementation commits after the reported issues were fixed. The original Field checkout's ten pending design/config changes remain byte-for-byte intact and were excluded from this release. No production records, users or emails were changed during validation.

### Device acceptance and rollback

The connected iPhone was unavailable. Production updates are published, but device uptake, camera, native screen-reader and force-close/reconnect acceptance still need a physical iPhone check. Browser tests and exports do not establish native device acceptance.

Field changes no native dependency, runtime or database schema. The prior production update group is `21db04a8-c496-42d2-aea2-741c737724e1`; republish it if a critical regression requires rollback, preserving queued submissions and draft storage. MSR can restore the prior Netlify production deploy if needed.
