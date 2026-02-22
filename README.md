# MSR Dashboard - Material Status Report

A modern, cloud-powered dashboard for tracking Material Status Reports (MSR) for the Frame 6B Power Group project.

**Live Site:** https://msrf6b.netlify.app

---

## Quick Start

**The dashboard is live!** Just visit: https://msrf6b.netlify.app

All data auto-updates from Supabase cloud database. No local setup required.

---

## Features

### 1. Overview Dashboard
- Executive KPI cards (Total POs, Total Value, Shipments, Installation Items)
- PO Status distribution (pie chart)
- Shipment Status breakdown (bar chart)
- Installation progress by discipline (multi-axis bar chart)
- **Auto-updates** from Supabase every time you sync

### 2. Procurement Dashboard
- Detailed Purchase Order table (97 POs, 808 line items)
- Real-time search functionality
- Status tracking and supplier breakdown
- **Live data** from Supabase

### 3. Shipments Dashboard
- Shipment tracking (121 shipments)
- Filter by status (Delivered, In Transit, Not RTS)
- ETA and delivery date tracking
- **Live data** from Supabase

### 4. Installation Dashboard
- Discipline summary cards (Civil, Electrical, Instrumentation, Mechanical, Steel)
- Installation items table (862 items)
- Filter by discipline
- Field quantities and work hours

### 5. Gap Analysis
- Visual gap analysis showing available metrics vs. missing data
- Priority-ranked critical gaps
- Recommended actions and completion tracking

### 6. Material Tracking
- Link PO items to installation tags
- Track material status: Ordered → Shipped → Received → Installed
- Real-time updates across all users
- Export to Excel
- Cloud-hosted with Supabase

### 7. Samsara Tracker Map
- Live location tracking for AT11 passive trackers
- Interactive map with 500m geofence around site
- Auto-categorizes as "On Site", "In Transit", or "Unknown"
- Permanent labels on map markers
- Filter by tracker status
- **Auto-syncs hourly** via GitHub Actions

---

## Technology Stack

### Frontend
- **HTML5 + CSS3** with responsive design
- **Bootstrap 5.3.2** for UI components
- **Chart.js 4.4.0** for data visualizations
- **Leaflet.js** for interactive maps
- **Font Awesome 6.5.1** for icons

### Backend
- **Supabase** (PostgreSQL + REST API + Real-time)
  - Cloud-hosted database
  - Auto-generated REST API
  - Real-time subscriptions
  - Free tier (500MB database)

### Deployment
- **Netlify** - Static site hosting
  - Auto-deploy from GitHub
  - HTTPS enabled
  - Custom domain support
  - Instant rollbacks

### Automation
- **GitHub Actions** - Hourly Samsara sync
  - Runs every hour at :00
  - Cloud-based (no local machine needed)
  - Email notifications on failure

### Data Processing
- **Python 3.x** for data sync scripts
- **Pandas** for data manipulation
- **Requests** for API calls

### Design System
- **RPS Branding:** Charcoal (#3a3a3a) + Lime Green (#8dc63f)
- Professional, energy-sector aesthetic

---

## Project Structure

```
ProjectProgressandPO/
├── 📄 index.html                       # Main dashboard
├── 📄 dashboard.js                     # Dashboard logic (Supabase)
├── 📄 gap-analysis.html                # MSR gap analysis page
├── 📄 material-tracking.html           # Material tracking interface
├── 📄 material-tracking-supabase.js    # Material tracking logic
├── 📄 samsara-tracking.html            # Samsara tracker map
├── 📄 samsara-tracking.js              # Samsara map logic
├── 📄 supabase-config.js               # Supabase credentials (public anon key)
├── 🗂️  supabase/
│   ├── schema.sql                      # Material tracking schema
│   ├── samsara_schema.sql              # Samsara tracker schema
│   ├── po_shipment_schema.sql          # PO & Shipment schema
│   └── update_geofence.sql             # Geofence update script
├── 🗂️  dashboard_data/
│   ├── audit_data.json                 # Installation audit data
│   └── discipline_summary.json         # Discipline summaries
├── 🗂️  .github/workflows/
│   └── sync-samsara.yml                # GitHub Actions hourly sync
├── 📄 sync_po_shipment_data.py         # Sync Excel → Supabase (PO/Shipments)
├── 📄 sync_samsara_data.py             # Sync Samsara API → Supabase
├── 📄 sync_samsara.bat                 # Windows batch file for Samsara sync
├── 📄 netlify.toml                     # Netlify deployment config
├── 📄 .env                             # Local environment variables
├── 📊 PO & Shipment Log.xlsx           # Source data (not in git)
├── 📊 [Audit Excel files]              # Installation data (not in git)
├── 📖 README.md                        # This file
├── 📖 DEPLOYMENT.md                    # Netlify deployment guide
├── 📖 GITHUB_ACTIONS_SETUP.md          # GitHub Actions setup
├── 📖 SETUP_AUTOMATED_SYNC.md          # Automated sync options
├── 📖 SETUP_PO_DASHBOARD_SYNC.md       # PO/Shipment sync setup
├── 📖 SUPABASE_SETUP_GUIDE.md          # Supabase detailed setup
├── 📖 SUPABASE_MIGRATION.md            # Architecture & migration
├── 📖 SAMSARA_API_GUIDE.md             # Samsara API documentation
├── 📖 RPS_BRANDING.md                  # Brand guidelines
└── 🗂️  _archive/                       # Old Flask backend (reference only)
```

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           DATA SOURCES                               │
├─────────────────────────────────────────────────────────────────────┤
│  Excel Files              Samsara API          Manual Input          │
│  • PO & Shipment Log      • Tracker locations  • Material links     │
│  • Audit files            • Last seen times    • Status updates     │
└──────────┬───────────────────────┬───────────────────┬──────────────┘
           │                       │                   │
           ▼                       ▼                   ▼
┌─────────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│  Python Sync Script │  │ GitHub Actions  │  │   Web Interface     │
│  (Manual/Scheduled) │  │  (Hourly Auto)  │  │ (material-tracking) │
└──────────┬──────────┘  └────────┬────────┘  └──────────┬──────────┘
           │                      │                       │
           └──────────────────────┼───────────────────────┘
                                  ▼
                    ┌──────────────────────────┐
                    │   SUPABASE DATABASE      │
                    │   (PostgreSQL Cloud)     │
                    ├──────────────────────────┤
                    │  • purchase_orders       │
                    │  • shipments             │
                    │  • dashboard_metrics     │
                    │  • samsara_trackers      │
                    │  • tracker_locations     │
                    │  • material_links        │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │   NETLIFY HOSTING        │
                    │   (Static Site CDN)      │
                    ├──────────────────────────┤
                    │  • Auto-deploy from Git  │
                    │  • HTTPS enabled         │
                    │  • Custom domain         │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │  END USERS   │
                          │  (Browsers)  │
                          └──────────────┘
```

**Key Points:**
- **No local server needed** - Everything runs in the cloud
- **Auto-updates** - GitHub Actions syncs Samsara data hourly
- **Manual sync** - Run Python scripts to update PO/Shipment data
- **Real-time** - Material tracking updates instantly via Supabase

---

## Updating Data

### Option 1: Automated (Samsara Only)
Samsara tracker data auto-syncs **every hour** via GitHub Actions. No manual action needed!

### Option 2: Manual Sync (PO & Shipments)

When your Excel file is updated:

```bash
cd C:\Users\thomasenglish\Desktop\ProjectProgressandPO
python sync_po_shipment_data.py
```

This will:
1. Read latest data from "PO & Shipment Log.xlsx"
2. Upload to Supabase database
3. Refresh dashboard metrics
4. Auto-update the live website

**Typical output:**
```
================================================================================
PO & SHIPMENT DATA SYNC
================================================================================

1. Syncing Purchase Orders...
   Successfully synced 808 PO records

2. Syncing Shipments...
   Successfully synced 109 shipment records

3. Refreshing Dashboard Metrics...
   Dashboard metrics refreshed successfully

================================================================================
SYNC COMPLETED SUCCESSFULLY
================================================================================
```

### Option 3: Samsara Manual Sync

```bash
python sync_samsara_data.py
```

Or double-click: `sync_samsara.bat`

---

## Database Tables

### Supabase Schema

**Material Tracking:**
- `material_links` - Links between PO items and installation tags
- `material_status_history` - Audit trail of status changes

**Purchase Orders & Shipments:**
- `purchase_orders` - 808 PO line items
- `shipments` - 109 tracked shipments
- `dashboard_metrics` - Pre-calculated KPIs

**Samsara Tracking:**
- `samsara_trackers` - Tracker metadata (name, serial, etc.)
- `tracker_locations` - Location history with timestamps
- `geofence_config` - Site location and radius (500m)

**Views:**
- `vw_po_summary` - PO statistics
- `vw_shipment_summary` - Shipment statistics
- `vw_recent_activity` - Latest changes
- `vw_current_tracker_locations` - Latest location per tracker

---

## Deployment

### Netlify (Production)

**Site URL:** https://msrf6b.netlify.app

**Auto-Deploy:**
1. Push to GitHub main branch
2. Netlify auto-detects changes
3. Builds and deploys in ~60 seconds
4. Live site updates automatically

**Manual Deploy:**
```bash
git add .
git commit -m "Update dashboard"
git push
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for full guide.

---

## GitHub Actions Automation

**Samsara Sync Workflow:**
- **Schedule:** Every hour at :00 (e.g., 1:00, 2:00, 3:00)
- **Runs in:** Cloud (GitHub-hosted runner)
- **Cost:** FREE (unlimited for public repos)
- **Notifications:** Email on failure

**Required Secrets:**
- `SAMSARA_API_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

See [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md) for setup.

---

## Security

### Current Setup
- ✅ HTTPS connections to Supabase
- ✅ Public anon key (safe for client-side)
- ✅ Environment variables for secrets
- ⚠️ No Row Level Security (anyone can read/write)
- ⚠️ No authentication required

### Production Recommendations
1. Enable Row Level Security (RLS) policies
2. Add user authentication (Supabase Auth)
3. Track actual user names
4. Set up automated backups

---

## Cost

**COMPLETELY FREE** for your usage:

- **Supabase Free Tier:** 500 MB database (you use ~10 MB)
  - Unlimited API requests
  - Unlimited users
  - Real-time updates included

- **Netlify Free Tier:** 100 GB bandwidth/month
  - 300 build minutes/month
  - Automatic HTTPS
  - Custom domain

- **GitHub Actions:** Unlimited for public repos
  - 2,000 minutes/month for private repos
  - You use ~1 minute per sync = ~720 minutes/month

**Total Cost:** $0/month 🎉

---

## Documentation

### Quick Guides
- **[README.md](README.md)** - This file (project overview)
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Netlify deployment
- **[GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)** - Auto-sync setup

### Setup Guides
- **[SETUP_PO_DASHBOARD_SYNC.md](SETUP_PO_DASHBOARD_SYNC.md)** - PO/Shipment sync
- **[SETUP_AUTOMATED_SYNC.md](SETUP_AUTOMATED_SYNC.md)** - Automation options
- **[SUPABASE_SETUP_GUIDE.md](SUPABASE_SETUP_GUIDE.md)** - Database setup

### Technical Docs
- **[SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md)** - Architecture & migration
- **[SAMSARA_API_GUIDE.md](SAMSARA_API_GUIDE.md)** - Samsara API reference
- **[RPS_BRANDING.md](RPS_BRANDING.md)** - Brand guidelines
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Old Flask version (archived)

---

## Troubleshooting

### Dashboard shows old data
- Run `python sync_po_shipment_data.py` to update
- Hard refresh browser: `Ctrl + Shift + R`
- Check "Last Updated" timestamp on dashboard

### Samsara trackers not updating
- Check GitHub Actions workflow status
- Verify secrets are set in GitHub repo settings
- Run `python sync_samsara_data.py` manually to test

### Material Tracking shows "Backend Disconnected"
- Check `supabase-config.js` has correct credentials
- Verify database schema was run in Supabase SQL Editor
- Check internet connection

### Netlify deployment failed
- Check build logs in Netlify dashboard
- Verify all files are committed to Git
- Check netlify.toml configuration

---

## Current Data Summary

- **97 Purchase Orders** (808 line items)
- **109 Shipments** tracked
- **862 Installation Items** across 5 disciplines
  - Civil: 212 items
  - Electrical: 166 items
  - Instrumentation: 112 items
  - Mechanical: 38 items
  - Steel: 334 items
- **50 Samsara Trackers** (AT11 passive)
- **Material Links:** Track in real-time via Supabase

---

## Project Info

**Project:** Frame 6B Power Group Material Status Report
**Contractor:** Relevant Power Solutions
**Dashboard Version:** 3.0 (Cloud-Hosted)
**Last Updated:** January 17, 2026

**Live Site:** https://msrf6b.netlify.app
**Supabase Project:** https://supabase.com/dashboard/project/lmdomalnuzbvxxutpyky
**GitHub Repo:** https://github.com/TomEnglish/MSR_F6B

---

## What's New in v3.0

- ✅ **Netlify Deployment** - Production hosting with auto-deploy
- ✅ **GitHub Actions** - Automated hourly Samsara sync
- ✅ **Samsara Integration** - Live tracker map with geofencing
- ✅ **PO/Shipment Supabase Migration** - All data now cloud-hosted
- ✅ **Auto-updating Dashboard** - No more manual JSON generation
- ✅ **Permanent Map Labels** - Tracker names always visible
- ✅ **Improved Data Sync** - Robust error handling and data cleaning

---

**Ready to go!** Visit https://msrf6b.netlify.app to see your live dashboard 🚀
