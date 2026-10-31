# Logistics: places and crates (office pages)

Phase 1 of logistics. Migration `supabase/migrations/021_places_and_handling_units.sql` is the contract; tests are in `tests/database/logistics-places-units-test.sql`. Both pages are under **Logistics** in the sidebar.

## Places (`places.html`)

- **Shared by every project.** The page reads and writes `places` with the unscoped `supabaseClient`. `places` is deliberately not in `PROJECT_SCOPED_TABLES`.
- **Who sees what.** Every active user sees the list, the map and each place's details. Office staff add, edit, retire and restore places.
  - A yard or site can be tied to one of the office user's active projects.
  - A place tied to a project the user isn't on is read-only for them, and the page says why.
  - Row security hides such a place from updates. An update that changes no rows is reported as not saved, never as saved.
- **Map point.** Click the form's map to set the point, then drag the pin to adjust it, or type the latitude and longitude.
  - The circle shows the arrival radius: 25 to 20,000 metres, 300 if left blank.
  - A point needs both coordinates or neither. Coordinates are rounded to the 6 decimal places the database keeps.
  - The maps use the same OpenStreetMap tiles as GPS Tracking.
- **Two people editing one place.** An edit saves only if nobody has changed the place since the form opened (the update is matched on `updated_at`). Otherwise the form says so and keeps what was typed.
- **Escape and unsaved changes.** Escape asks before discarding changes.
  - Chrome lets a page refuse Escape only once per user action, so the drawer may close anyway. When it does, the page asks again and reopens the drawer with the changes if you keep them.
  - While a save is running, the drawer stays open.
- **Retiring and naming.** Nothing is deleted; a retired place is listed under **Retired** and can be restored.
  - Names are unique among active places, ignoring case. Restoring a place whose name an active place now uses is refused with that reason.
- **Shop Contacts.** Places replaces Shop Contacts in the sidebar. The old page and its data are untouched. (Outside Shops was rebuilt in phase 2; see below.)

## Crates (`handling-units.html`)

- **Read-only in the browser.** The list comes from `handling_unit_overview` and a crate's contents from `handling_unit_items`, both read through the project scope. Every change to a crate is a field `pack` or `unpack` operation.
- **Filters.** Filter by status, and search by code (typed any way, with or without `HU-`) or by description.
- **Where a nested crate is.** It shows the crate it sits inside, plus its outermost crate's place and area.
- **The drawer.** It lists the items packed in the crate and the crates inside it. Each crate code links to that crate, so you can move up and down the nesting.

### Crate labels

**Print crate labels** is for office staff on an active project. It calls `reserve_handling_unit_labels(project, count)`, with 1 to 500 labels at a time.

1. The print window opens during the click, before the call, so the browser doesn't block it.
2. A blocked pop-up reserves nothing.
3. A refused call closes the window and shows the reason.
4. **Print the last labels again** reprints the last batch without reserving new codes.

What a label holds:

- The QR code holds **only the code text**, e.g. `HU-7K3QX9`, at high error correction (H), so a scuffed label still scans.
- The code is printed below the QR code in large type.
- Labels print six to a letter page.
- QR codes are drawn with [qrcode-generator 1.4.4](https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js), loaded from cdnjs with an integrity hash.
- A reserved label becomes a crate the first time the field packs it; unused labels stay unused.

## Trying it locally

Run `python3 tests/browser/serve.py`, then open `http://127.0.0.1:8092/places.html` or `/handling-units.html`.

- The fixture backend has made-up places, including a retired yard, a yard in a project the fixture user isn't on, and a markup-named shop.
- It also has crates nested three deep, and it answers label reservations.
- To see the field-worker view, run `sessionStorage.setItem('fixtureRole', 'field_worker')` in the browser console and reload.

## Loads (`loads.html`)

- **Board.** Columns for planning, loading, in transit and delivered. A switch shows closed and cancelled loads instead.
  - Each card shows the load number, the origin and next stop, the driver, and the piece counts that aren't zero (written off included).
  - It also shows any flags, "Started in the field", "Left without licence", "Licence on file" and the planned date.
  - Office staff get a third switch, "Started in the field (N)", while crews have open loads they started. It lists those loads so the office can check them and plan the rest.
  - Everything comes from `load_overview`, read through the project scope.
- **New load.** The form makes a load ID with `crypto.randomUUID()`. Its first `load_save` creates the load and gets its number; the drawer then opens in full. A load someone other than office staff creates is started in the field.
- **Every change is one operation.** Each is `apply_field_operation` with a new operation ID.
  - 022's refusals are shown as the database words them.
  - While a change saves, the drawer is disabled and a second change says so.
  - The board and the load reload afterwards, saved or refused.
- **The drawer.** It has sections for status, details, companies, stops, the manifest and, for office staff, the driver's licence.
  - A section with unsaved edits keeps them when another section saves; every other section is redrawn from what was just read.
  - An edit the change made pointless is dropped: stop edits from before departure once the truck has left, anything once the load is finished.
  - Escape asks before dropping edits.
  - A finished load, or any load on a project that isn't active, shows its details and companies as text.
  - Saving details sends only the fields that changed, since `load_save` changes only the keys it is sent. Someone else's change to another field stays, and an origin retired since doesn't block saving the rest.
- **Who plans.** Office staff plan loads; a crew plans the stops and pieces only of a load it started. Others see "The office plans…" instead of the forms.
- **Stops.** Before departure, stops are added, reordered and removed. New stops get their IDs on the page, so pieces planned for a stop stay with it.
  - After departure, each stop shows what's due, delivered, missing and still to pick up.
  - Office staff can choose **Change stops** while the truck is on the road. Stops it has reached are shown as they are and stay put; the others can change, move or come off. Taking off the last stop not yet reached delivers the load.
  - At an outside shop or vendor, office staff confirm without scanning, as `stop_complete` with `confirmAll`. The button is "Mark delivered" at a drop-off stop, "Confirm pick-ups" at a pick-up stop, and "Mark delivered and picked up" at a stop that is both. Pieces planned for pick-up there go on board.
  - "Finish stop" warns that pieces not scanned off become missing and pieces to pick up that weren't scanned on stay behind. At an outside shop or vendor only office staff finish a stop.
- **Manifest.** It's grouped by drop-off stop. A piece is planned by crate code or item tag, or taken off the plan, until the truck leaves.
  - It can be given a pick-up stop, which has to come before the stop it comes off at.
  - "If it's planned on another load that hasn't left, move it here" sends `move: true`. The status line names the load it came from.
  - Flags (extra, wrong stop, found), missing and written-off pieces are shown.
  - Office staff mark a missing piece found at a place, with a note, or write it off with a reason (`line_write_off`). Writing off a crate also writes off the crates inside it and everything they hold.
  - Administrators can undo a write-off with a reason (`line_write_off_undo`, with the ID from `load_write_offs`). The piece is missing again, and a closed load opens again until it is found or written off again.
- **Status actions.**
  - "Mark loaded and depart" (office) is `load_depart` with `confirmAll`. It is offered only when the truck leaves an outside shop or vendor; elsewhere a crew scans pieces on.
  - "Depart with what's on board" sends the truck off with what was scanned on; the rest stays behind.
  - **The licence comes first.** 022 lets a truck leave only with the licence number and a photo of it. Without them the Status section says so.
    - For a crew, "Depart with what's on board" is disabled, and the button points to that note.
    - Office staff choosing either depart action get a form, "Let it leave without the licence", which needs a reason of 5 to 500 characters. It is sent as `overrideReason`, and the drawer then shows when and why the truck left without it.
  - "Cancel load" (office) calls `load_close` with `cancel`. "Close load" (office) is offered once every stop is finished and nothing is missing.
- **Driver's licence (office staff only).** Field staff never read it, and the page doesn't ask for it for them.
  - The number, state and expiry are saved with `record_driver_licence`, with a new operation ID each time. The page repeats the last four characters only when 022 sends them, which it does only for numbers longer than six letters and digits.
  - Office staff on a project that isn't active can read the licence, but not change it, as 022's calls require. Once a load closed more than 90 days ago, the form isn't offered.
  - Photos are shown through 5-minute signed links.
  - A new photo is uploaded to `driver-licences/<load id>/<new id>.jpg` (or `.png`) without upsert, then attached, both under the save lock. A photo is offered only while the load's folder holds fewer than four files.
  - The page lists the load's folder, so a photo that uploaded but was never attached (here or from a phone) is offered for attaching, even after the drawer was closed.
  - **Delete photo**, in each photo's caption, deletes the file through Storage, then calls `remove_driver_licence_photo`. If the second step fails, the photo shows "The file has been deleted" with **Finish removing**. Deleting the last photo before departure warns that the truck can't leave without a new one.
  - **Remove the licence** removes a wrong licence early. It asks why, deletes every file in the folder, then calls `remove_driver_licence(load, reason)`. The licence can then be recorded again.
- **Printed manifest.** It opens during the click, as the crate labels do, with one page section per stop: tag, piece and high-value mark.
  - It shows the load, driver name and phone, truck, trailer, bill of lading and companies, plus signature lines for the shipper, driver and receiver.
  - The print code is never given the licence, nor the reason a truck left without it.
- **Removing old licences.** A daily job (`.github/workflows/purge-driver-licences.yml`) removes each licence 365 days after its load closes (migration 023; a licence the office is keeping stays), or after the load's last change if it never closes. The page is a backup for it.
  - When office staff open Loads (on any project), the page runs `driver_licences_due_for_removal()`, which covers every project they can see. For each due load it deletes every file 022 lists in the load's folder through Storage, then calls `remove_driver_licence`.
  - A small note says how many were removed and which couldn't be, naming a load from another project as such. The board is then read again, since removal clears "Licence on file".
  - It runs in the background and never blocks the board.

## Outside Shops (`outside-shop-inventory.html`)

Rebuilt on 022's data; the old `outside_shop_inventory` and `shop_contacts` tables are no longer read and stay as they were. Every place of kind `outside_shop` gets a section. A retired shop is listed only while something is still there. Each section lists:

- **Crates there now:** top-level rows of `handling_unit_overview` with that place and status `delivered`.
- **Loose items there now:** `load_line_overview` rows that are the piece's current position, delivered there.

Each row shows how long the piece has been there (from `off_at`) and links to the load that brought it (`loads.html?load=<id>`).

## Trying loads locally

`tests/browser/serve.py` also serves `tests/support/loads-model.js`, a small model of 022's operations, licence functions, bucket and views. The node page tests use the same model.

The fixture has made-up loads:

- one being planned, leaving a vendor with no licence recorded (to try leaving without it);
- one in transit, with a licence and a photo;
- one delivered, with a missing piece (to write off, close and undo);
- one closed long enough ago that opening Loads removes its licence;
- one cancelled;
- one a crew started in the field.

The fixture user is an administrator, so write-offs can be undone.

## Loads and items (database contract, migration 022)

Phase 2 of logistics, reworked after the 31 October workflow review. Migration `supabase/migrations/022_loads_and_drivers.sql` is the contract. Tests: `tests/database/logistics-loads-test.sql`, `logistics-places-units-test.sql`, `field-operations-test.sql` and `initial-inventory-test.sql`, plus races in `concurrency-test.sh`.

### Decisions it enforces

- **A licence before the truck leaves.** `load_depart` needs a licence number and at least one attached photo. Otherwise office staff can send `overrideReason` (5 to 500 characters); it is kept on the load with who and when. A crew sending it is refused (`42501`).
- **The office plans; a crew can start a load.** A load created by someone who isn't office staff is `started_in_field`. On such a load the crew can plan pieces and change stops until it leaves; on any other load, only office staff can (`42501`). Anyone can still scan an unplanned piece on, with its drop-off stop. A crew planning its own load can't take a piece off the office's plan (`42501`), though a crew loading a truck can (`move`), since the piece is on that truck.
- **Shop and vendor stops are the office's.** At a place of kind `outside_shop` or `vendor`, only office staff can `stop_complete`. `confirmAll` works only there: it delivers what was due and boards what was to be collected there. `load_depart` with `confirmAll` works only when the origin is a shop or vendor.
- **Write-offs.** Office staff `line_write_off` a missing piece with a reason. The crate, every crate inside it and every item they hold are written off (crates and lines `written_off`, materials `written_off` with quantity 0, count records `written_off_at`), and `load_write_offs` keeps what they were. An administrator can `line_write_off_undo`, which puts everything back and makes the piece missing again; a closed load opens again (delivered) so the piece can be scanned or found, and is closed again after.

### Tags and labels

- **A tag is unique within its project, whatever its capitals.** The same tag can be used in two projects. Look tags up within the project and ignoring case; `lookup_tag(project_id, code)` does that.
- **HU- codes are crate labels and nothing else.** A check on `qr_codes` keeps them apart, and they are unique across projects. Counting, importing or receiving an HU- code is refused.
- **Receiving a counted tag** uses the counted spelling. Only an accepted delivery links the tag and marks the count received; the received material takes over the count's crate and load lines. A rejected delivery leaves the tag free and puts `rejected_receipt_id` on the count. The inspection condition is required.
- **A tag received before it was counted or imported** gets a count record that is already received, and the material moves to where it was counted (unless it is packed, travelling or, for crews, held). Receiving and counting one tag take turns, and both wait for an import, so a count can't miss a receipt being saved at the same moment.
- **`lookup_tag(project_id, code)`** answers with `kind`: `crate`, `unused_label`, `unknown_label`, `received`, `counted`, `expected`, `written_off` or `unknown`, and `can_receive`, which is true only for an item tag with no receipt in this project that isn't on a truck or written off. Item answers carry the `item_positions` columns.

### Where things are

- **One answer per item: `item_positions`.** A received item is its material; an item not yet received is its count record. `position` is `on_load` or `missing` (the load says where), `in_crate` (where the outermost crate is), `at_place` (its own place and area), `gone` (issued, shipped, used up or written off) or `unknown`. It also gives the crate, the load, the place and area, high value, and `hold` (`on_hold`, `return_to_vendor`).
- **Items have their own place.** `materials` gained `place_id`, `site_map_id` and `zone_id`; `inventory_records` gained `place_id`. They change on receipt (the rack's area), count, transfer, unpacking, taking out of a crate, unloading, office confirmation, `line_found` and `relocate`.
- **A site plan draws one place** (`site_maps.place_id`, an active yard or site). An area has to be at the place given: on a plan drawn for that place or, for a plan not yet tied to a place, at one of the project's own yards or sites. With an area and no place, the plan's place is used. A new place without an area clears the old area. An area is required (when sealing a crate or counting) only where the place has a plan with areas.
- **Racks and areas.** A rack is linked to at most one active area (`site_map_zones.location_id`). `location_areas` lists each rack with its area. A received or transferred material takes its rack's area; a material put in an area takes that area's rack (none if it has none), and one taken to another place without an area is no longer on a yard rack. A change of rack is recorded in `material_movements`.
- **Plans the migration ties to places.** Each existing plan is tied to its project's yard or site where the project has just one. A plan not yet tied to a place accepts its areas at any yard or site, never at a shop or vendor.

### Stock that isn't loose

- **In a crate or on a truck:** transfer, recount, relocate and Ship Out are refused with "take it out of the crate" or "when it comes off". Issuing from a crate is allowed: issuing all of it takes it out; issuing part leaves the rest packed with the lower quantity, and opens a sealed crate. Nothing is issued from a truck.
- **On hold or being returned** (the receipt's exception decision): crews can't pack, load or issue it, and can transfer, relocate or move it (in its crate) only to a hold area: a hold-area rack, or an area linked to one. A count of it elsewhere doesn't move it. Office staff can do all of these.
- **Away at a shop or vendor:** rack transfers are refused; it comes back on a load.
- **Ship Out** is for office staff, for stock leaving the project for good.
- **Count records** change only through counting, importing and receiving; office staff can't insert or update them directly.

### What is stored

- **`loads`**: one outside carrier's truck trip, numbered `L-0001` upwards per project. Status runs planning → loading → in transit → delivered → closed; a load can be cancelled until it leaves. It holds the origin, planned date, truck and trailer numbers, bill of lading number, notes, the driver's name and phone, `started_in_field`, `edited_at` (when its latest saved change was made), `licence_recorded_at` and the licence override.
- **`load_companies`**: up to 3 per load, from the one we hired to the one whose truck it is.
- **`load_stops`**: in order; drop-off, pick-up or both; pending → arrived (scan, tracker or office) → done. A stop taken off is kept as cancelled.
- **`load_lines`**: one line per top-level crate or loose item. Planned → on board → delivered, missing or written off; planned pieces can end not loaded or removed. Flags: `extra`, `wrong_stop`, `found`. A piece is on at most one load while planned, on board or missing.
- **`load_write_offs`**: each write-off, what it changed, and its undo.
- **Crates on a load**: `on_load` while on board, `delivered` at the stop's place (and area), `missing`, or `written_off`. A crate that's on a load, missing or written off, or inside one, can't be packed, unpacked or moved; a planned crate can't go inside another or be unpacked.

### Operations (`apply_field_operation`)

Each change is one operation with its own operation ID; only the keys sent change. A load's ID is made by the caller, so offline steps can name it.

| Action | Payload | Who |
|---|---|---|
| `pack` | `unitCode`, `kind?`, `description?`, `isHighValue?`, `placeId?`, `siteMapId?`, `zoneId?`, `add?: [tag]`, `remove?: [tag]`, `seal?`, `partial?`, `capturedAt?` | anyone; held stock office only |
| `unpack` | `unitCode`. Everything comes out where the outermost crate is. | anyone |
| `move` | `unitCode`, `placeId?`, `siteMapId?`, `zoneId?`, `capturedAt?`. A crate moved without being opened keeps its seal; a sealed one needs an area where its place has a plan. | anyone |
| `relocate` | `tag`, `placeId?`, `siteMapId?`, `zoneId?`, `reason?`, `capturedAt?`. Corrects where a loose item is without a recount. | anyone |
| `count` | as before, plus `placeId?`, `isHighValue?`, `capturedAt?` | anyone |
| `receiving` | as before; `inspection.condition` required; `material.is_high_value?` | anyone |
| `transfer`, `issue` | as before | anyone; held stock office only |
| `shipment` | as before | office only |
| `load_save` | `loadId`, any of `originPlaceId`, `plannedDate`, `truckType`, `truckNumber`, `trailerNumber`, `bolNumber`, `notes`, `driverName`, `driverPhone`, `companies` (replaces, ≤3), `stops: [{id, placeId, kind?, plannedDate?}]` (replaces), `capturedAt?`. After departure, stops change only by office staff and only ones not yet reached; with none left to reach, the load is delivered. A new load needs an active project. | anyone; stops as above |
| `load_plan` | `loadId`, `add: [{code, dropoffStopId, pickupStopId?, move?}]`, `remove: [code]`, `partial?`. Before departure. | office, or the crew on a load started in the field |
| `load_on` | `loadId`, `pieces: [code or {code, dropoffStopId?, move?}]`, `undo?: [code]`, `stopId?`, `partial?`, `capturedAt?` | anyone |
| `load_depart` | `loadId`, `confirmAll?`, `overrideReason?`, `capturedAt?` | anyone; `confirmAll` and `overrideReason` office only |
| `load_off` | `loadId`, `stopId`, `pieces: [code]`, `siteMapId?`, `zoneId?`, `partial?`, `capturedAt?`. Allowed until the load is closed. | anyone |
| `stop_complete` | `loadId`, `stopId`, `confirmAll?`, `capturedAt?` | anyone at our yards and sites; office only at shops and vendors |
| `load_close` | `loadId`, `cancel?`. Closing needs every stop done and no piece missing. | office only |
| `line_found` | `lineId`, `placeId`, `note?` | office only |
| `line_write_off` | `lineId`, `reason` | office only |
| `line_write_off_undo` | `writeOffId`, `reason` | administrators only |

Refusals: `22023` with a message that can be shown as is, `42501` for access, `23505` for an operation ID reused for a different request.

### Device time, partial lists and moving pieces

- **`capturedAt`**: when the change was made on the device, as an ISO 8601 time with a zone; a clock running ahead counts as now. Two devices' times within 5 minutes of each other count as the same moment (`logistics_clock_slack()`), so a phone whose clock runs a little behind isn't refused; the later upload wins. A count made before the latest count of that tag is refused; so is a `load_save` made before the load's `edited_at`, and a licence change made before the latest one. `load_on` without a stop after departure is accepted only for scans made before departure (a second phone's late uploads), and not for a piece that has travelled on another load since; if the drop-off stop is already done the piece is missing. A `load_off` scan at another stop moves a delivered piece there, unless it was made before the scan recorded, or the piece has since gone on another load or changed (`22023`).
- **Arrival.** A stop is marked arrived by the first piece actually scanned on or off there; a scan where everything was refused doesn't count.
- **`partial: true`**: pack, load_plan, load_on and load_off apply the tags they can and return the others in `refused: [{code, list?, message, sqlstate}]`, instead of refusing the whole list. A partial pack with refusals isn't sealed.
- **`move: true`**: on a piece in `load_plan` or `load_on`, takes it off another load's plan if that load hasn't left; the answer lists it in `moved`. Without it, the step is refused and says which load has it.

### The licence, outside `field_operations`

- **`record_driver_licence(operation_id, load_id, {number, state?, expiry?, capturedAt?})`**: every operation ID is remembered, so a retry is answered and never applied again. Field staff can record while the load is open; office staff at any time. A licence past its removal date can't be recorded. It answers `last4` (and logs it) only for numbers longer than six letters and digits, otherwise null.
- **`attach_driver_licence_photo(load_id, path)`** after uploading to `driver-licences/<load id>/<name>.jpg`, `.jpeg` or `.png`, without upsert. Storage refuses other names, sub-folders and a fifth file in a load's folder.
- **Office removal at any time.** Delete a wrong photo through Storage, then call `remove_driver_licence_photo(path, reason?)`. `remove_driver_licence(load_id, reason)` needs a reason (5+ characters) before the licence is due; delete the folder's files through Storage first. Removal clears `loads.licence_recorded_at`, and a licence can then be recorded again.
- **Due for removal** (migration 023): 365 days after the load closes or is cancelled, or 365 days after its last activity if it never closes. `load_overview.licence_due_at` gives each load's date to anyone on the project. `driver_licences_due_for_removal()` lists due loads on the office user's projects with every file in each folder.
- **Never without warning.** `driver_licences_due_soon(days?)` lists, for office staff, every licence due in the next 30 days (or the days asked), overdue kept ones included, with `kept`, `keep_reason` and `kept_at`. The Loads page shows it as the warning.
- **Keeping a licence.** Office staff call `keep_driver_licence(load_id, reason)` (5 to 500 characters), for example while a tracker the driver kept is recovered, and `release_driver_licence_hold(load_id)` when it can go. A kept licence is never listed as due, purged by the daily job or removed by hand; releasing it lets it be removed at its date. Both are audited (`driver_licence_kept`, `driver_licence_hold_released`) and stay out of crews' activity.
- **Daily job.** `.github/workflows/purge-driver-licences.yml` runs `scripts/purge-driver-licences.mjs` with the service role: `driver_licence_purge_queue()`, delete each folder's files, `purge_driver_licence(load_id)`. It needs the `SUPABASE_SERVICE_ROLE_KEY` repository secret.
- **Projects** can't be completed or archived while any of their loads is open. The admin function passes the database's reason through (409 `REFUSED`).

### Places and activity

- **Shared places** can't be tied to one project while other projects use them, and their kind can't change and they can't be retired by an office user who doesn't work every project using them; an administrator can. Every change to a place is in the audit log.
- **Activity.** `audit_log` is readable by office staff only (administrators also see entries with no project). Everyone on a project reads `list_project_activity(project_id, before?, limit?)`: what happened, to what (`subject`: the load number, crate label or tag), who and when, with a fixed set of safe details and no licence events.

### Views

- **`load_overview`**: one row per load, with origin and origin kind, next stop, piece counts by status (including written off), flagged count, stop counts, `started_in_field`, `edited_at`, `licence_recorded_at`, `licence_complete` (a number and a photo are both on file, which is what departure needs; readable by crews) and the override.
- **`load_stop_overview`**: stops in order with place and place kind, and counts due, delivered, missing and to pick up.
- **`load_line_overview`**: manifest lines with name, high value, pick-up, drop-off and delivered places, flags and `is_current_position`.
- **`handling_unit_overview`**: also `top_status`, `place_kind`, and the load its outermost crate is planned for, on board or missing from.
- **`item_positions`** and **`location_areas`**: see above.
