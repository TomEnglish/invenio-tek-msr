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
