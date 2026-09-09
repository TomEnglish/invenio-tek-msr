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
