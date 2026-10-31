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
- **Shop Contacts.** Places replaces Shop Contacts in the sidebar. The old page and its data are untouched, and Outside Shops is unchanged.

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

## Loads (database contract, migration 022)

Phase 2 of logistics. Migration `supabase/migrations/022_loads_and_drivers.sql` is the contract; tests are in `tests/database/logistics-loads-test.sql` plus a race test in `tests/database/concurrency-test.sh`.

### What is stored

- **`loads`**: one outside carrier's truck trip.
  - Numbered `L-0001` upwards per project.
  - Status runs planning → loading → in transit → delivered → closed. A load can be cancelled until it leaves.
  - Holds the origin place, planned date, truck and trailer numbers, the carrier's bill of lading number, notes, and the driver's name and phone.
- **`load_companies`**: up to 3 companies per load, in order from the one we hired to the one whose truck it is. Each has a name, a role (broker, carrier, dispatcher or other), a contact and a phone.
- **`load_stops`**: the places the truck goes to after it leaves, in order.
  - Each stop is a drop-off, a pick-up, or both.
  - Status is pending, arrived (by scan, tracker or office), then done.
  - A stop taken off the plan is kept as cancelled, with no position in the order.
- **`load_lines`**: the manifest, one line per top-level crate or loose item.
  - Status: planned → on board → delivered or missing. A planned piece can also end as not loaded (left behind) or removed (taken off the plan).
  - Flags: `extra` (came off but the records didn't have it on the truck), `wrong_stop` (came off somewhere other than its drop-off stop), `found` (was missing, then turned up).
  - **A piece is on at most one load at a time** while it's planned, on board or missing.
  - A crate inside another crate, or an item packed in a crate, can't go on separately: it travels with its crate.
- **Crates on a load**: a crate's status becomes `on_load` when it goes on, then `delivered` at the stop's place. Its status is `missing` if it wasn't unloaded where it was due.
  - A crate that's on a load or missing, or sits inside one, can't be packed or unpacked.
  - A planned crate can't go inside another crate or be unpacked.
  - A delivered crate can be repacked, unpacked or loaded again.
- **Driver licences** (`load_driver_licences`, `driver_licence_photos`): only office staff can read them.
  - Photos are in the private `driver-licences` bucket at `<load id>/<name>.jpg`.
  - Field staff can upload a photo but can't read it back. **Upload without upsert**: upserting needs read access. When retrying, an "already exists" error means the earlier upload landed.

### Operations (`apply_field_operation`)

Each change is one operation with its own operation ID. A load's ID is made by the caller (a UUID), so steps taken offline can refer to a load before it syncs. Only the keys sent are changed.

| Action | Payload | Who |
|---|---|---|
| `load_save` | `loadId`, and any of: `originPlaceId`, `plannedDate` (YYYY-MM-DD), `truckType`, `truckNumber`, `trailerNumber`, `bolNumber`, `notes`, `driverName`, `driverPhone`, `companies: [{name, role?, contactName?, phone?}]` (replaces the list, at most 3), `stops: [{id, placeId, kind?, plannedDate?}]` (replaces the list; only before the truck leaves). Creates the load if the ID is new. | anyone working the project |
| `load_plan` | `loadId`, `add: [{code, dropoffStopId, pickupStopId?}]`, `remove: [code]`. Only before the truck leaves. | anyone |
| `load_on` | `loadId`, `pieces: [code or {code, dropoffStopId}]`, `undo: [code]`, `stopId?`. A piece that wasn't planned needs a drop-off stop. `stopId` is for picking up at a pick-up stop after the truck has left. | anyone |
| `load_depart` | `loadId`, `confirmAll?`. Needs the driver's name and something on board. Planned pieces not on board stay behind. `confirmAll` marks every planned piece loaded without scanning, for a load leaving a place nobody scans at. | anyone; `confirmAll` office only |
| `load_off` | `loadId`, `stopId`, `pieces: [code]`, `zoneId?`, `siteMapId?`. The first scan marks the stop arrived. An area can only be chosen at this project's own yard or site. | anyone |
| `stop_complete` | `loadId`, `stopId`, `confirmAll?`. Pieces due at the stop that weren't scanned off become missing, or delivered with `confirmAll`. Finishing the last stop makes the load delivered. | anyone; `confirmAll` office only |
| `load_close` | `loadId`, `cancel?`. Closes a delivered load, or cancels one that hasn't left, which puts its crates back as they were. | office only |
| `line_found` | `lineId`, `placeId`, `note?`. A missing piece turned up. | office only |

Refusals use SQLSTATE `22023` with a message that can be shown as is, and `42501` for access.

### The licence, outside `field_operations`

These calls keep the number out of `field_operations`. The audit log records only the last four characters.

- **`record_driver_licence(operation_id, load_id, {number, state?, expiry?})`**: records or corrects the licence. A repeated operation ID returns the first answer.
  - Field staff can call it while the load is open; office staff can call it at any time.
  - It returns `{recorded, last4}`. `loads.licence_recorded_at` then tells everyone a licence is on file.
- **`attach_driver_licence_photo(load_id, path)`**: call it after the upload. A load keeps at most 4 photos.
- **Removal after 90 days**: office staff call `driver_licences_due_for_removal()` for loads closed more than 90 days ago.
  1. Delete each load's photos through Storage. Deleting is allowed only then, and only for office staff.
  2. Call `remove_driver_licence(load_id)`. It refuses while any photo is still stored, then clears the number, the state and the expiry.

The office Loads page does this whenever office staff open it.

### Views

- **`load_overview`**: one row per load, with origin, next stop, piece counts by status, flagged count, stop counts, and whether a licence is on file.
- **`load_stop_overview`**: stops in order, with their place, and counts due, delivered and missing.
- **`load_line_overview`**: manifest lines with the piece's name, high-value flag, pick-up, drop-off and delivered places, flags, and `is_current_position`. That marks the line that says where a piece is now: its latest line that put it on a truck, off at a place, or missing.
- **`handling_unit_overview`**: also shows `top_status`, plus the `load_id`, `load_number` and `load_line_status` of the load its outermost crate is planned for, on board, or missing from.
