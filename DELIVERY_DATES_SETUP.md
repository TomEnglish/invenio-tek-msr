# Ready By Dates Integration - Complete Guide

## Overview

The Ready By Dates feature tracks expected "Ready to Ship" dates for installation items, linking them to Purchase Orders and Suppliers.

**Status:** ✅ Backend Complete - UI Updates Pending

---

## What's Been Done

### 1. Supabase Database Schema ✅

**File:** `supabase/ready_by_dates_schema.sql`

**Tables Created:**
- `ready_by_dates` - Main table storing 108 ready-to-ship date records

**Fields:**
- `project_phase` - Project phase (e.g., "Simple Cycle - New")
- `package_description` - Description of package/item
- `tag_number` - Installation tag number
- `supplier_name` - Supplier name
- `po_number` - Links to purchase_orders table
- `ready_to_ship_date` - Expected ready date (single date)
- `ready_date_notes` - For date ranges (e.g., "1/20/2026 - 2/14/2026")

**Views Created:**
- `vw_ready_dates_with_po` - Joins ready dates with PO information
- `vw_upcoming_ready_dates` - Shows items ready in next 30 days

### 2. Sync Script ✅

**File:** `sync_ready_by_dates.py`

**Features:**
- Reads `ReadyByDates.xlsx`
- Handles date ranges and single dates
- Robust NaN/None handling
- Batch uploads (100 records at a time)
- Links to PO numbers

**Usage:**
```bash
python sync_ready_by_dates.py
```

**Output:**
```
Ready date records synced: 108
```

---

## Data Structure

### Sample Record

```json
{
  "project_phase": "Simple Cycle - New",
  "package_description": "SCR",
  "tag_number": "Stacks - U-101, U-201, U-301",
  "supplier_name": "Braden Americas",
  "po_number": "14723",
  "ready_to_ship_date": "2026-01-20",
  "ready_date_notes": null
}
```

### Date Range Example

```json
{
  "package_description": "Upper Stack Assemblies",
  "po_number": "14723",
  "ready_to_ship_date": "2026-01-20",
  "ready_date_notes": "1/20/2026 - 2/14/2026"
}
```

---

## Next Steps - UI Integration

### Option 1: Material Tracking Page

Show ready dates when viewing PO items:

**Display:**
- When a PO item is selected, show its ready-to-ship date
- Highlight items ready in next 7 days in yellow
- Highlight overdue items in red

**Implementation:**
1. Load ready_by_dates data in material-tracking-supabase.js
2. Join with PO data by po_number
3. Add "Ready Date" column to PO items table
4. Add visual indicators for upcoming/overdue dates

### Option 2: Shipments Dashboard

Add ready dates to shipment tracking:

**Display:**
- Show expected ready date alongside ETA
- Calculate days until ready
- Flag shipments where ready date < ETA (potential delays)

**Implementation:**
1. Load ready_by_dates in dashboard.js
2. Join with shipments by po_number
3. Add "Ready Date" column to shipments table
4. Add alerts for date mismatches

### Option 3: New "Ready Dates" Dashboard

Create dedicated page for ready-to-ship tracking:

**Features:**
- Calendar view of upcoming ready dates
- Filter by supplier, PO, or date range
- Export to Excel
- Email alerts for items ready this week

**Implementation:**
1. Create ready-dates.html (similar to samsara-tracking.html)
2. Create ready-dates.js
3. Add to navigation menu
4. Use Supabase views for data

---

## Updating Data

### When ReadyByDates.xlsx Changes

1. Update the Excel file
2. Run sync script:
   ```bash
   python sync_ready_by_dates.py
   ```
3. Data updates automatically on dashboard

### Automation Options

**Option A: Manual Sync**
- Run script whenever Excel file is updated
- Simple and controlled

**Option B: Scheduled Sync**
- Add to GitHub Actions (like Samsara sync)
- Run daily or weekly
- Requires Excel file in repo or cloud storage

---

## Database Queries

### Get All Ready Dates with PO Info

```sql
SELECT * FROM vw_ready_dates_with_po;
```

### Get Items Ready This Week

```sql
SELECT *
FROM ready_by_dates
WHERE ready_to_ship_date >= CURRENT_DATE
  AND ready_to_ship_date <= CURRENT_DATE + INTERVAL '7 days'
ORDER BY ready_to_ship_date;
```

### Get Ready Dates for Specific PO

```sql
SELECT *
FROM ready_by_dates
WHERE po_number = '14723'
ORDER BY ready_to_ship_date;
```

### Get Upcoming Items by Supplier

```sql
SELECT supplier_name, COUNT(*) as item_count, MIN(ready_to_ship_date) as next_ready_date
FROM ready_by_dates
WHERE ready_to_ship_date >= CURRENT_DATE
GROUP BY supplier_name
ORDER BY next_ready_date;
```

---

## Files

### Created
- `supabase/ready_by_dates_schema.sql` - Database schema
- `sync_ready_by_dates.py` - Sync script
- `READY_BY_DATES_SETUP.md` - This file

### Modified
- None yet (UI updates pending)

### Required
- `ReadyByDates.xlsx` - Source data (108 records)

---

## Current Status

✅ **Completed:**
- Database schema created
- Sync script working
- 108 records uploaded to Supabase
- Documentation complete

⏳ **Pending:**
- UI integration (Material Tracking)
- UI integration (Shipments page)
- Optional: New Ready Dates dashboard
- Optional: Email alerts for upcoming dates

---

## Support

**To update data:**
```bash
python sync_ready_by_dates.py
```

**To verify data in Supabase:**
Go to: https://supabase.com/dashboard/project/lmdomalnuzbvxxutpyky
- Click "Table Editor"
- Select "ready_by_dates" table
- View all 108 records

**To query data:**
- Use SQL Editor in Supabase
- Or query via JavaScript using Supabase client

---

**Last Updated:** January 17, 2026
**Version:** 1.0
**Status:** Backend Complete, UI Pending
