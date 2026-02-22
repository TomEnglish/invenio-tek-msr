# Setup Guide: Auto-Updating Dashboard with Supabase

This guide will migrate your main dashboard from static JSON files to live Supabase data.

---

## Step 1: Create Database Tables in Supabase

1. **Open Supabase SQL Editor**
   - Go to: https://supabase.com/dashboard/project/lmdomalnuzbvxxutpyky/sql/new
   - Or navigate to your project → SQL Editor (left sidebar)

2. **Run the Schema SQL**
   - Open the file: `supabase/po_shipment_schema.sql`
   - Copy ALL the contents
   - Paste into Supabase SQL Editor
   - Click **"Run"** (or press Ctrl+Enter)

3. **Verify Tables Were Created**
   - Go to Table Editor (left sidebar)
   - You should see three new tables:
     - `purchase_orders`
     - `shipments`
     - `dashboard_metrics`

---

## Step 2: Upload Your Excel Data to Supabase

Run the Python sync script to upload your PO & Shipment data:

```bash
cd C:\Users\thomasenglish\Desktop\ProjectProgressandPO
python sync_po_shipment_data.py
```

You should see:
```
================================================================================
PO & SHIPMENT DATA SYNC
================================================================================

1. Syncing Purchase Orders...
   Reading PO data from Excel...
   Uploading 808 PO records to Supabase...
   Successfully synced 808 PO records

2. Syncing Shipments...
   Reading shipment data from Excel...
   Uploading 121 shipment records to Supabase...
   Successfully synced 121 shipment records

3. Refreshing Dashboard Metrics...
   Dashboard metrics refreshed successfully

================================================================================
SYNC COMPLETED SUCCESSFULLY
================================================================================
Purchase Orders synced: 808
Shipments synced: 121
Dashboard metrics: Refreshed
================================================================================
```

---

## Step 3: Update Dashboard to Read from Supabase

The dashboard JavaScript will be updated to query Supabase instead of JSON files.

---

## Step 4: Test the Dashboard

1. **Open your Netlify dashboard**
2. **Check that data loads**
3. **Verify "Last Updated" timestamp is current**
4. **Test all charts and metrics**

---

## Step 5: Set Up Auto-Sync (Optional)

### Option A: Manual Sync
Whenever you update your Excel file, run:
```bash
python sync_po_shipment_data.py
```

### Option B: Automated with Batch File
Create a desktop shortcut to `sync_po_shipment_data.bat`:
```batch
@echo off
cd C:\Users\thomasenglish\Desktop\ProjectProgressandPO
python sync_po_shipment_data.py
pause
```

Double-click the shortcut after updating Excel.

### Option C: Add to GitHub Actions
We can add this to the hourly GitHub Actions workflow, but it requires:
- Committing your Excel file to Git (currently in .gitignore)
- Or manually uploading Excel to a cloud storage that GitHub can access

---

## Troubleshooting

### Error: "Worksheet named 'PO Data' not found"
- Fixed - script now looks for "PO Parts Log" sheet

### Error: "SUPABASE_URL not found"
- Ensure `.env` file has correct credentials

### Error: "Table does not exist"
- Run Step 1 first to create tables in Supabase

### Data not showing in dashboard
- Check browser console for errors
- Verify Supabase tables have data (use Table Editor)
- Hard refresh browser (Ctrl+Shift+R)

---

## What Data Gets Synced

### From "PO Parts Log" Sheet →  `purchase_orders` table:
- All PO line items with pricing, status, suppliers
- 808 records total

### From "Shipment Log" Sheet → `shipments` table:
- All shipment tracking data with dates, status, locations
- 121 records total

### Calculated Metrics → `dashboard_metrics` table:
- Total POs, total value, shipment counts
- Status breakdowns for charts
- Auto-calculated from above tables

---

## Benefits of Supabase Integration

✅ **Auto-updating** - No need to regenerate JSON files
✅ **Real-time** - Changes reflect immediately
✅ **Consistent** - Same system as Samsara and Material Tracking
✅ **Scalable** - Can handle more data without performance issues
✅ **Collaborative** - Multiple users see same live data

---

## Next Steps After Setup

1. ✅ Run the initial sync to populate Supabase
2. ✅ Verify dashboard loads correctly from Supabase
3. ✅ Update your workflow to sync after Excel changes
4. ✅ Consider migrating Excel to cloud (Google Sheets + auto-sync)

---

**Ready to proceed?** Run Step 1 in Supabase SQL Editor!
