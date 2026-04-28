# Power BI Replacement Spec

This document preserves the functional requirements from the deprecated Power BI files that were previously stored in `PBIX/`. The current source of truth is the Invenio Field MSR web app plus the Supabase schemas and sync scripts in this repo.

## Deprecated PBIX Assets Replaced

- `LOGISTICS UPGRADED DB (11-18) RC (1).pbix`
- `Master_Inventory_02 (1).pbix`
- `OutsideShopInventory (1).pbix`
- `OutsideShopInventory_v2 (1).pbix`
- `OutsideShops.pbix`
- Screenshot references:
  - `LogisticsUpgraded.png`
  - `MasterInventory2.png`
  - `OutsideInventory2.png`
  - `OutsideShopInventory.png`
  - `OutsideShops.png`

## Replacement Principle

The web app should replace Power BI as the operational dashboard surface. Power BI artifacts are no longer required when the web app provides:

- Equivalent page coverage
- Equivalent filters and summary counts
- Equivalent table-level detail
- Live or sync-backed Supabase data
- Exportable/reportable views where needed
- Maintainable source-controlled HTML, JS, SQL, and Python sync scripts

## Shared Visual Requirements

- Header includes project identity and clear page title.
- Pages use the Invenio Field MSR design system, not legacy Power BI chrome.
- Tables support scan-friendly row density, readable column headers, and horizontal overflow where needed.
- Filters should be visible above or beside table content and should update results without page reload.
- Date freshness must be visible where the page depends on external sync data.
- Export actions should preserve the active filter context where practical.

## Page: Shipment Visibility

Power BI source: `LOGISTICS UPGRADED DB (11-18) RC (1).pbix`

Current web equivalents:

- `index.html`
- `dashboard.js`
- `project-schedule.html`
- `project-schedule.js`
- `supabase/po_shipment_schema.sql`
- `sync_po_shipment_data.py`

Required content:

- Summary cards:
  - Total shipment count
  - Not yet shipped count
  - In-transit count
  - Delivered count
- Filters:
  - Cargo description
  - Shipment mode
  - Shipment type
  - Shipment ID
  - Shipment status/page presets: all, delivered, planned, in-transit
- Table columns:
  - Cargo description
  - Mode
  - Ship type
  - Origin
  - Destination
  - Shipped date
  - Delivery date or ETA
  - Shipment ID/number
  - Supplier/category where available
- Data source:
  - `shipments`
  - `purchase_orders` where PO context is needed
  - `dashboard_metrics` for summary rollups

Parity criteria:

- User can answer how many shipments exist, how many are delivered, and what is still not shipped.
- User can filter shipments by mode/type/status and inspect line-level logistics details.
- User can see the same operational distinctions represented in Power BI: not yet shipped, in transit, and delivered.

## Page: Master Inventory

Power BI source: `Master_Inventory_02 (1).pbix`

Current web equivalents:

- `inventory.html`
- `outside-shop-inventory.html`
- `supabase/inventory_schema.sql`
- `supabase/seed_inventory_data.sql`

Required content:

- Summary cards:
  - Inventory count
- Filters:
  - Unit/subsystem
  - Inventory item
  - Status/location where available
- Table columns:
  - QR code
  - Inventory item
  - Item description
  - Unit
  - Subsystem
  - Location
  - Status
- Data source:
  - `inventory_records`

Parity criteria:

- User can filter inventory by unit/subsystem.
- User can search or filter inventory item descriptions.
- User can inspect QR codes and inventory item names without relying on PBIX files.

## Page: Outside Shop Inventory

Power BI sources:

- `OutsideShopInventory (1).pbix`
- `OutsideShopInventory_v2 (1).pbix`

Current web equivalents:

- `outside-shop-inventory.html`
- `outside-shop-inventory.js`
- `supabase/inventory_schema.sql`
- `supabase/seed_inventory_data.sql`

Required content:

- Filters:
  - Shop/vendor
  - Load name
  - QR ID
  - Delivery date/status where available
- Table columns:
  - Load name
  - QR ID
  - Scanner comments
  - Delivery date
  - Item status
- Contact panel:
  - Shows selected shop/vendor contact details
  - Includes address and primary contacts when available
- Data sources:
  - `outside_shop_inventory`
  - `shop_contacts`
  - `shipments` for optional delivery/logistics context

Parity criteria:

- User can filter by outside shop and load name.
- User can see QR IDs and scanner comments for outside-shop items.
- User can view the relevant shop contact info in the same workflow.

## Page: Logistics Contact List

Power BI source: `OutsideShops.pbix`

Current web equivalents:

- `outside-shop-inventory.html`
- `shop_contacts` table via `supabase/inventory_schema.sql`

Required content:

- Table columns:
  - Location/vendor
  - Contact details
  - Address
  - Phone/email where available
  - Notes where available
- Data source:
  - `shop_contacts`

Parity criteria:

- User can find vendor/location contact information without opening Power BI.
- Contact data is stored in Supabase or source-controlled seed data.

## Data Ownership

The replacement web app owns these Supabase tables and views:

- `shipments`
- `purchase_orders`
- `dashboard_metrics`
- `inventory_records`
- `outside_shop_inventory`
- `shop_contacts`
- `vw_outside_shop_details`
- `vw_shipment_visibility`

The phone app shares the operational receiving/material tables:

- `qr_codes`
- `receiving_records`
- `materials`
- `material_movements`
- `material_issues`
- `shipments_out`
- `audit_log`

When dashboard pages display phone-app operational data, they must respect the same project scoping and RLS rules as the phone app.

## Acceptance Checklist

- [ ] `inventory.html` covers Master Inventory PBIX requirements.
- [ ] `outside-shop-inventory.html` covers Outside Shop Inventory PBIX requirements.
- [ ] Shipment views cover Logistics Upgraded DB PBIX requirements.
- [ ] Contact list is available from Supabase-backed web UI.
- [ ] Active filters are visible and reflected in table results.
- [ ] Summary counts match Supabase source data.
- [ ] Export/PDF output works for the main operational views.
- [ ] No production workflow requires opening a `.pbix` file.

## Archival Decision

The PBIX files are deprecated local artifacts. They are not tracked in git and should not be reintroduced unless Power BI becomes an active delivery target again. This spec is the durable replacement record for their intended dashboard behavior.
