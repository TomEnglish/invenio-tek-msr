# Invenio Field MSR - Quick Start Guide

## 🚀 Getting Started

### First Time Setup (One-Time, 10 minutes)

**If this is your first time:**

1. **Set up Supabase** (for Material Tracking):
   - Follow **[setup-supabase.md](setup-supabase.md)** - only takes 8 minutes!
   - Your project is already created: https://supabase.com/dashboard/project/lzroduricxyshgyjdkki

2. **Extract Excel Data**:
   ```bash
   python extract_data_for_dashboard.py
   ```

### Every Time You Use It (2 steps)

### Step 1: Double-click `start_dashboard.bat`
This will:
- Start a local web server
- Automatically open the dashboard in your browser

### Step 2: View the Dashboard
The dashboard will open at: **http://localhost:8000**

If it doesn't open automatically, manually open that URL in your browser.

---

## 📱 Dashboard Pages

### Main Dashboard Views

1. **Overview** - Executive summary with KPIs and charts
2. **Procurement** - Detailed PO tracking (97 POs, 808 line items)
3. **Shipments** - Shipment status and tracking (121 shipments)
4. **Installation** - Installation progress by discipline (862 items)

### New Features ⭐

5. **Gap Analysis** - Visual tracking of available vs. missing metrics
6. **Material Tracking** - Link PO items to installation tags (cloud-powered!)
   - Real-time updates
   - Track status: Ordered → Shipped → Received → Installed
   - Export to Excel

---

## 🎨 Dashboard Features

### Overview Tab
- **4 KPI Cards**: Total POs, Total Value, Shipments, Installation Items
- **PO Status Chart**: Pie chart showing distribution of PO statuses
- **Shipment Status Chart**: Bar chart of shipment statuses
- **Discipline Chart**: Multi-axis chart showing items and hours by discipline

### Procurement Tab
- Searchable table of all purchase orders
- Columns: PO ID, Description, Status, Supplier, Category, Delivery Date, Net Value
- Real-time search filtering

### Shipments Tab
- Filterable table of all shipments
- Filter by status: Delivered, In Transit, Not RTS, RTS
- Columns: Shipment #, PO #, Status, Supplier, Category, ETA, Delivery Date, # Pieces

### Installation Tab
- Discipline summary cards (Civil, Electrical, Instrumentation, Mechanical, Steel)
- Detailed items table with filtering by discipline
- Shows field quantities and work hours

---

## 🔄 Updating Data

When your Excel files are updated:

1. **Stop the web server** (Press Ctrl+C in the command window)
2. **Run the extraction script**:
   ```bash
   python extract_data_for_dashboard.py
   ```
3. **Restart the dashboard**:
   ```bash
   start_dashboard.bat
   ```

Or simply run `start_dashboard.bat` again - it will auto-detect if data needs updating.

---

## 🎨 Design System

The dashboard uses **Relevant Power Solutions** branding:

### Color Palette (RPS Branding)
- **Primary Charcoal**: `#3a3a3a` (Main brand color)
- **Lime Green**: `#8dc63f` (RPS signature color)
- **White**: `#ffffff` (Clean, professional)
- **Light Gray**: `#e8e8e8` (Backgrounds)
- **Medium Gray**: `#cccccc` (Borders)
- **Dark Gray**: `#666666` (Text)

### Branding
- **Logo**: RPS_Logoavif.avif (displayed in navbar)
- **Font**: Arial, Helvetica Neue, Helvetica
- **Modern gradient-based design**
- **Energy sector professional aesthetic**

### UI Elements
- Rounded corners (12px)
- Soft shadows
- Smooth transitions (0.3s)
- Hover effects on interactive elements
- Professional, energy-sector appropriate styling

---

## 📊 Current Data Summary

Based on your Excel files:
- **97 Purchase Orders** (808 line items)
- **121 Shipments** tracked
- **862 Installation Items** across 5 disciplines
  - Civil: 212 items
  - Electrical: 166 items
  - Instrumentation: 112 items
  - Mechanical: 38 items
  - Steel: 334 items

---

## ⚠️ Known Limitations

### Missing Data (see MSR_Dashboard_Analysis.md for details)
- ❌ Actual installation progress (ERN_QTY fields empty)
- ❌ Material receipt dates/locations
- ❌ Link between PO items and installation items
- ❌ NCR/OSD details
- ❌ Material Required Dates

### Available Now
- ✅ PO tracking and status
- ✅ Shipment tracking
- ✅ Budgeted installation quantities
- ✅ Work hour budgets
- ✅ Milestone definitions

---

## 🛠️ Troubleshooting

### Dashboard won't load
- Make sure you're running the web server (`start_dashboard.bat`)
- Check that port 8000 isn't already in use
- Try: http://localhost:8000 directly

### No data showing
- Ensure `dashboard_data/` folder exists with 7 JSON files
- Re-run: `python extract_data_for_dashboard.py`
- Check browser console (F12) for errors

### Charts not displaying
- Ensure you have internet connection (CDN resources needed)
- Check browser console for JavaScript errors
- Try a different browser (Chrome, Edge, Firefox)

### Python script fails
```bash
pip install pandas openpyxl
```

---

## 📁 File Structure

```
Invenio Field MSR/
├── start_dashboard.bat          ← Double-click this to start!
├── index.html                   ← Dashboard HTML
├── dashboard.js                 ← Dashboard logic
├── extract_data_for_dashboard.py ← Data extraction script
├── dashboard_data/              ← Generated JSON files
│   ├── dashboard_metrics.json
│   ├── po_data.json
│   ├── shipments.json
│   ├── audit_data.json
│   └── ...
└── [Excel source files]
```

---

## 📞 Support Files

- **README.md** - Full documentation
- **MSR_Dashboard_Analysis.md** - Detailed analysis of available metrics and gaps
- **QUICK_START.md** - This file!

---

## 🎯 Next Steps

1. **Share the dashboard** - Copy this entire folder to share with team members
2. **Set up auto-refresh** - Schedule the extraction script to run daily
3. **Populate missing data** - Work on filling ERN_QTY fields for actual progress tracking
4. **Customize** - Adjust colors, add new charts, modify tables as needed

---

**Dashboard Version:** 1.0
**Last Updated:** January 15, 2026
**Project:** Frame 6B Power Group
**Contractor:** Relevant Power Solutions

Enjoy your new Invenio Field MSR! 🎉
