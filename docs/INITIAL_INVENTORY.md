# Initial field inventory — database contract

Migration `supabase/migrations/019_initial_inventory.sql` adds initial counting ahead of receiving. This page is the contract the Field app (Count tab) and the office pages build against. Tests: `tests/database/initial-inventory-test.sql`.

## The idea in one paragraph

The office imports the tags it expects to find (early data), builds a category tree and uploads a site plan per project. Field crews walk the site, scan each tag (the QR value **is** the tag number), confirm or create the item, pick a category, and drop a pin on the plan. A later receipt for the same tag links to the counted item and marks it received.

## Tables

| Table | What it holds | Who writes |
|---|---|---|
| `inventory_categories` | Tree per project: `id`, `parent_id`, `name`, `status` (`active` / `proposed` / `archived`), `sort_order`, `proposed_by`. Sibling names are unique, ignoring case, among non-archived rows. Parents must be in the same project and the tree cannot loop. | Office directly; field only proposes through a count |
| `site_maps` | `id`, `name`, `storage_path`, `image_width`, `image_height`, `is_active` | Office |
| `site_map_zones` | `map_id`, `name`, `shape` (polygon, 3–200 points of `[x, y]` in 0–1 image coordinates, origin top-left), `color` (`#RRGGBB`), optional `location_id` (an existing rack location in the same project) | Office |
| `inventory_records` (extended) | Existing columns plus `uid`, `category_id`, `part_number`, `quantity` (up to 3 decimals), `uom` (default `EA`), `condition` (`good` / `damaged` / `mixed`), `count_status`, `source`, `site_map_id`, `pin_x`, `pin_y` (0–1), `zone_id`, `counted_by`, `counted_at`, `receiving_record_id` | Field via `count`; office directly or via import |
| `inventory_photos` | `inventory_uid`, `storage_path` | Only `attach_inventory_photo` |

- **Tag rule:** `btrim(qr_code)` is unique per project. Match tags with trimmed, case-sensitive text.
- **`count_status`:** `expected` (imported, not yet found) → `counted` → `received` (linked to a receipt). `received` is set only by receiving.
- **`source`:** `import`, `field`, or `legacy` (rows that existed before 019, grouped under a top-level category per old `unit`).
- **Legacy columns** (`unit`, `subsystem`, `location`, `status`) are kept so the existing Yard Inventory page keeps working. A count writes the zone name into `location`.

## Field: `apply_field_operation(op_id, project_id, 'count', payload)`

Same idempotency as every field operation: replaying an `op_id` with the same payload returns the first result; a different payload under the same `op_id` fails with `23505`. Queue it offline exactly like receiving.

```json
{
  "tag": "GT2-LO-001",
  "name": "Lube oil cooler",
  "description": "optional",
  "partNumber": "optional; blank keeps an imported part number",
  "quantity": "1.5",
  "uom": "EA",
  "condition": "good",
  "categoryId": "uuid or null",
  "proposedCategory": { "parentId": "uuid or null", "name": "Pressure Valve" },
  "siteMapId": "uuid or null",
  "pin": { "x": 0.42, "y": 0.61 },
  "zoneId": "uuid or null",
  "notes": "optional"
}
```

- `quantity` is a string of up to 9 digits with up to 3 decimals, greater than zero.
- Send **either** `categoryId` **or** `proposedCategory`, not both. A proposal reuses an existing category with the same name under the same parent; otherwise it creates one with `status = 'proposed'`.
- `pin` requires `siteMapId`; both coordinates must be numbers in 0–1. `zoneId` must be on that map.
- Counting an existing `expected` or `counted` tag updates it. A blank `description` or `partNumber` keeps the stored value. A `received` tag is refused.
- **Result:** `{ "uid", "id", "created", "category_id", "count_status": "counted" }`. Use `uid` for photo paths.

### Receiving change

`'receiving'` now also marks any non-received inventory row with the same tag as `received` and links `receiving_record_id`. Its result gains `inventory_uid` (`null` when there was no count). Nothing else about receiving changed.

To start a receipt from a count, read the row by tag and prefill: `inventory_item`/`item_description` → description, `quantity` → qty (whole numbers only), `part_number` → spec.

## Photos and site plans (Supabase Storage, both private)

| Bucket | Path | Read | Write |
|---|---|---|---|
| `inventory-photos` | `<inventory uid>/<op_id>-<n>.jpg` | project members | anyone who can work the project |
| `site-plans` | `<project_id>/<map_id>.<png\|jpg\|jpeg\|webp>` | project members | office users |

After uploading a photo, call `attach_inventory_photo(p_inventory_uid, p_path)`. Repeating it is harmless. Set `site_maps.storage_path` to the uploaded path; the database rejects any other path. Use signed URLs to display.

## Office functions

### `import_inventory_items(p_project_id, p_items jsonb, p_dry_run boolean default true)`

Each item is an object with only these keys: `tag` (required), `name`, `description`, `category_path` (`"Gas Turbine 2 > Lube Oil > Cooler"`), `part_number`, `quantity` (default `1`), `uom` (default `EA`). 1–5000 items per call.

- Every row is checked first. If any row is invalid, or a tag appears twice, **nothing** is written and the errors come back.
- Missing categories along each path are created (`active`); a `proposed` category on the path becomes `active`.
- New tags become `expected` / `import`. Existing `expected` tags are refreshed. **Counted and received tags are never overwritten** (`skip_counted`, `skip_received`).
- `p_dry_run = true` returns the same report without writing anything. Show it as a preview, then call again with `false`.

Result:

```json
{ "applied": true, "created": 2, "updated": 0, "skipped": 1, "new_categories": 4,
  "errors": [ { "row": 3, "tag": "BAD-Q", "message": "Quantity must be a positive number" } ],
  "rows":   [ { "row": 1, "tag": "GT2-LO-001", "action": "create" } ] }
```

### `merge_inventory_category(p_from, p_into)`

Moves items and child categories from `p_from` to `p_into`, archives `p_from`, and activates `p_into` if it was proposed. Use it to fold a field proposal into the right place. It refuses a merge into one of `p_from`'s own subcategories (`22023`), and refuses when both have a child with the same name (`23505`; merge those first). To simply approve a proposal, update its `status` to `active`.

## Errors

| Code | Meaning |
|---|---|
| `42501` | No access: wrong project, inactive account, or something from another project |
| `22023` | Invalid input (missing tag or name, bad quantity, pin off the map, received tag) |
| `23505` | Operation ID reused with different input, or a naming conflict |
| `23514` | A table check failed (bad zone shape, wrong storage path) |

## Access summary

- Members of a project can read all of the above for that project.
- Office users (office staff and admins) on an active project can insert and update categories, maps, zones and inventory records directly, and call import and merge.
- Field workers write only through `apply_field_operation` and `attach_inventory_photo`.
- No browser role can delete any of these rows.
