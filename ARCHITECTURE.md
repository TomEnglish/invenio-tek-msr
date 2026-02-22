# Material Tracking System - Architecture & Design

## Problem Statement

**Gap:** No linkage between Purchase Order data and Installation Item data.

**Need:** Allow users to associate PO items with installation items (tag numbers, line numbers, equipment IDs) and track this relationship in a persistent database.

---

## Solution Overview

### Architecture: Lightweight Full-Stack Application

```
┌─────────────────┐
│   Frontend UI   │  HTML/JS - Material linking interface
│   (Browser)     │
└────────┬────────┘
         │ HTTP/REST API
         ▼
┌─────────────────┐
│  Backend API    │  Python Flask - REST endpoints
│  (Flask Server) │
└────────┬────────┘
         │ SQL
         ▼
┌─────────────────┐
│    Database     │  SQLite - Material associations
│   (SQLite DB)   │
└─────────────────┘
```

---

## Technology Stack

### Frontend
- **HTML5 + Bootstrap 5** - Responsive UI
- **Vanilla JavaScript** - AJAX calls, no framework needed
- **RPS Branding** - Consistent with dashboard

### Backend
- **Python Flask** - Lightweight web framework
- **Flask-CORS** - Enable cross-origin requests
- **SQLite** - Serverless SQL database (no setup required)

### Why This Stack?
- ✅ **Minimal Dependencies**: Only need Python + Flask
- ✅ **No Complex Setup**: SQLite requires zero configuration
- ✅ **Portable**: Single .db file can be backed up/shared
- ✅ **Fast Development**: Can be running in minutes
- ✅ **Easy Deployment**: Can run on localhost or simple cloud server

---

## Database Schema

### Table: `material_links`
Links PO items to installation items

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `po_id` | TEXT | Purchase Order ID |
| `po_line_item` | INTEGER | PO line item number |
| `po_description` | TEXT | Item description from PO |
| `install_tag` | TEXT | Installation tag number (e.g., "PI-170-1") |
| `install_discipline` | TEXT | Discipline (civil, electrical, etc.) |
| `install_description` | TEXT | Description from audit file |
| `material_status` | TEXT | Status: ordered, shipped, received, installed |
| `receipt_date` | DATE | Date material received |
| `receipt_location` | TEXT | Storage location |
| `installation_date` | DATE | Date material installed |
| `quantity` | REAL | Quantity linked |
| `uom` | TEXT | Unit of measure |
| `notes` | TEXT | User notes |
| `linked_by` | TEXT | User who created link |
| `created_at` | TIMESTAMP | When link was created |
| `updated_at` | TIMESTAMP | Last update time |

### Table: `material_status_history`
Audit trail of status changes

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `material_link_id` | INTEGER | FK to material_links |
| `old_status` | TEXT | Previous status |
| `new_status` | TEXT | New status |
| `changed_by` | TEXT | User who made change |
| `changed_at` | TIMESTAMP | When changed |
| `notes` | TEXT | Change notes |

---

## API Endpoints

### Base URL: `http://localhost:5000/api`

#### 1. Get All PO Items
```http
GET /api/po-items
```
**Response:**
```json
{
  "success": true,
  "data": [
    {
      "po_id": "14723",
      "line_item": 1,
      "description": "Simple Cycle System - SCR",
      "supplier": "Braden Americas, Inc.",
      "status": "Follow-Up Document Created",
      "linked": false
    }
  ]
}
```

#### 2. Get All Installation Items
```http
GET /api/installation-items?discipline=civil
```
**Response:**
```json
{
  "success": true,
  "data": [
    {
      "tag": "PI-170-1",
      "discipline": "instrumentation",
      "description": "Pressure Indicator",
      "quantity": 1,
      "uom": "EA",
      "linked": true
    }
  ]
}
```

#### 3. Create Material Link
```http
POST /api/material-links
Content-Type: application/json

{
  "po_id": "14723",
  "po_line_item": 1,
  "install_tag": "PI-170-1",
  "install_discipline": "instrumentation",
  "quantity": 1,
  "linked_by": "John Doe"
}
```

#### 4. Get All Material Links
```http
GET /api/material-links
```

#### 5. Update Material Status
```http
PUT /api/material-links/{id}/status
Content-Type: application/json

{
  "status": "received",
  "receipt_date": "2026-01-15",
  "receipt_location": "Laydown Area B",
  "changed_by": "Jane Smith"
}
```

#### 6. Delete Material Link
```http
DELETE /api/material-links/{id}
```

#### 7. Search/Filter Links
```http
GET /api/material-links/search?po_id=14723
GET /api/material-links/search?tag=PI-170-1
GET /api/material-links/search?status=received
```

---

## User Workflows

### Workflow 1: Link PO to Installation Item

```
1. User opens Material Tracking page
2. Searches for PO item by PO number or description
3. Selects PO item from list
4. Searches for installation item by tag/description
5. Selects installation item from list
6. Clicks "Create Link"
7. System creates association in database
8. Both items now show as "linked" in UI
```

### Workflow 2: Update Material Status

```
1. User views list of linked materials
2. Finds material that was recently received
3. Clicks "Update Status" button
4. Selects new status: "Received"
5. Enters receipt date and location
6. Clicks "Save"
7. System updates database and logs history
8. Dashboard reflects new status
```

### Workflow 3: Bulk Import Links

```
1. User prepares CSV file with PO-to-Tag mappings
2. Uploads CSV via web interface
3. System validates each row
4. Creates all links in database
5. Shows summary (X created, Y failed with reasons)
```

---

## Frontend UI Components

### Material Tracking Page

**Layout:**
```
┌──────────────────────────────────────────────┐
│  [Search PO Items] [v]  [Search Install] [v] │
├──────────────────────────────────────────────┤
│                                              │
│  ┌──────────────────┐  ┌─────────────────┐  │
│  │   PO Items       │  │  Install Items  │  │
│  │   [List]         │  │  [List]         │  │
│  │                  │  │                 │  │
│  └──────────────────┘  └─────────────────┘  │
│                                              │
│         [Create Link Button]                 │
│                                              │
├──────────────────────────────────────────────┤
│           Existing Links                     │
│  ┌──────────────────────────────────────┐   │
│  │ PO    | Tag    | Status  | [Actions]│   │
│  │ 14723 | PI-170 | Ordered | [Update] │   │
│  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

**Features:**
- Dual-panel search interface
- Real-time filtering
- Drag-and-drop linking (future enhancement)
- Inline status updates
- Export to Excel
- Bulk import from CSV

---

## Security Considerations

1. **Authentication** (Phase 2)
   - Basic HTTP Auth for initial version
   - JWT tokens for production

2. **Authorization** (Phase 2)
   - Role-based access control
   - Read-only vs. Editor roles

3. **Data Validation**
   - Sanitize all inputs
   - Prevent duplicate links
   - Validate foreign key relationships

4. **Audit Trail**
   - Log all changes to status_history table
   - Track who made changes and when

---

## Deployment Options

### Option 1: Local Development (Immediate)
```bash
# Run on developer machine
python backend/app.py
# Access at http://localhost:5000
```

### Option 2: Local Network Server
```bash
# Run on project office computer
python backend/app.py --host 0.0.0.0
# Team accesses via http://192.168.1.X:5000
```

### Option 3: Cloud Deployment (Future)
- **Heroku**: Free tier, one-click deploy
- **AWS EC2**: More control, scalable
- **Azure App Service**: Enterprise option
- **DigitalOcean Droplet**: Simple, affordable

---

## Migration Path

### Phase 1: MVP (This Week)
- ✅ Create database schema
- ✅ Build Flask API with basic endpoints
- ✅ Create Material Tracking UI
- ✅ Implement create/read/delete links
- ✅ Test with 10-20 sample links

### Phase 2: Enhanced (This Month)
- Add status updates and history
- Implement bulk import
- Add user authentication
- Create reporting views
- Integrate with main dashboard

### Phase 3: Advanced (Next Month)
- QR code scanning
- Mobile app for field updates
- Real-time notifications
- Advanced analytics
- Schedule integration

---

## Data Backup Strategy

### SQLite Backup
```bash
# Daily automatic backup
cp material_tracking.db backups/material_tracking_$(date +%Y%m%d).db

# Keep last 30 days
```

### Export to Excel
```python
# Built-in export function
# Downloads all links as Excel file
```

### Git Integration
```bash
# Commit database snapshots
git add material_tracking.db
git commit -m "Material links update $(date +%Y-%m-%d)"
```

---

## Cost Analysis

| Component | Cost | Notes |
|-----------|------|-------|
| Frontend | $0 | Static HTML/JS |
| Backend (Flask) | $0 | Open source |
| Database (SQLite) | $0 | File-based |
| Hosting (Local) | $0 | Use existing hardware |
| Hosting (Cloud) | $0-$7/mo | Heroku free tier or DO droplet |
| **Total** | **$0-$7/mo** | Minimal cost! |

---

## Next Steps

1. Review this architecture with team
2. Get approval for Flask/SQLite approach
3. Begin implementation (see IMPLEMENTATION.md)
4. Test with sample data
5. Train users on new system

---

**Version**: 1.0
**Date**: January 15, 2026
**Status**: Design Complete - Ready for Implementation
