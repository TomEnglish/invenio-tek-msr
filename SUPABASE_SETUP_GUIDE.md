# Supabase Setup Guide - Material Tracking System

## Overview

This guide will walk you through setting up Supabase as the backend for your Material Tracking System. Supabase replaces the local Flask backend with a fully managed cloud database and API.

**Time Required:** ~15 minutes
**Cost:** FREE (for this project size)

---

## Step 1: Create a Supabase Account

### 1.1 Sign Up

1. Go to **https://supabase.com**
2. Click **"Start your project"**
3. Sign up with:
   - GitHub (recommended - fastest)
   - Google
   - Email

### 1.2 Verify Email

- Check your email for verification link
- Click to verify your account

---

## Step 2: Create a New Project

### 2.1 Create Project

1. Click **"New Project"**
2. Fill in the details:
   - **Name:** `MSR Material Tracking` (or your preference)
   - **Database Password:** Choose a strong password (save this!)
   - **Region:** Select closest to your location
     - US East (N. Virginia) - `us-east-1`
     - US West (Oregon) - `us-west-1`
     - Europe (Ireland) - `eu-west-1`
     - Asia Pacific (Singapore) - `ap-southeast-1`
   - **Pricing Plan:** Free

3. Click **"Create new project"**

### 2.2 Wait for Provisioning

- Project creation takes ~2 minutes
- You'll see "Setting up project..." status
- Dashboard will load when ready

---

## Step 3: Set Up the Database

### 3.1 Open SQL Editor

1. In your project dashboard, find the left sidebar
2. Click **"SQL Editor"** (icon looks like a database with a play button)

### 3.2 Run the Schema Script

1. Click **"+ New query"**
2. Open the file `supabase/schema.sql` from your project folder
3. **Copy the entire contents** of the file
4. **Paste** into the SQL Editor
5. Click **"Run"** (or press `Ctrl+Enter`)

### 3.3 Verify Tables Created

You should see a success message:
```
Material Tracking Database Schema Created Successfully!
Tables created:
  - material_links
  - material_status_history
```

### 3.4 Check Tables (Optional)

1. Click **"Table Editor"** in the left sidebar
2. You should see:
   - `material_links`
   - `material_status_history`

---

## Step 4: Get Your API Credentials

### 4.1 Navigate to Settings

1. Click **"Settings"** (gear icon) in the left sidebar
2. Click **"API"** in the settings menu

### 4.2 Copy Your Credentials

You'll need two values:

#### **Project URL**
- Look for **"Project URL"**
- It looks like: `https://xxxxxxxxxxxxx.supabase.co`
- Click the **copy icon** to copy it

#### **API Key (anon/public)**
- Scroll down to **"Project API keys"**
- Find **"anon" "public"** key
- Click the **copy icon** to copy it
- This is a long string like: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

**IMPORTANT:** This anon key is safe to use in your browser - it's designed to be public and protected by Row Level Security.

---

## Step 5: Configure Your Application

### 5.1 Open Configuration File

Open `supabase-config.js` in your text editor.

### 5.2 Update Credentials

Replace the placeholder values:

```javascript
const SUPABASE_CONFIG = {
    // Replace with your Project URL
    url: 'https://xxxxxxxxxxxxx.supabase.co',

    // Replace with your anon/public key
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',

    // Keep the options as-is
    options: {
        // ... existing options
    }
};
```

### 5.3 Save the File

- Save `supabase-config.js`
- **Do NOT commit this file to public GitHub repos** (it's in .gitignore)

---

## Step 6: Test the Connection

### 6.1 Start the Dashboard

```bash
start_dashboard.bat
```

Or manually:
```bash
python -m http.server 8000
```

### 6.2 Open Material Tracking

Navigate to: **http://localhost:8000/material-tracking.html**

### 6.3 Check Connection Status

At the top of the page, you should see:

✅ **"Connected: Supabase database is connected and ready"**

If you see an error, check:
- URL and key are correct in `supabase-config.js`
- No extra spaces or quotes
- Database schema was run successfully

---

## Step 7: Test Functionality

### 7.1 Create Your First Link

1. **Select a PO item** from the left panel
2. **Select an installation item** from the right panel
3. Enter quantity and UOM (optional)
4. Click **"Create Link"**

### 7.2 Verify in Supabase

1. Go back to your Supabase dashboard
2. Click **"Table Editor"**
3. Select **"material_links"**
4. You should see your new link!

### 7.3 Test Real-Time Updates

1. Open the Material Tracking page in **two browser tabs**
2. Create a link in **Tab 1**
3. Watch it appear automatically in **Tab 2** (real-time!)

---

## Step 8: Enable Row Level Security (Optional but Recommended)

### What is RLS?

Row Level Security (RLS) controls who can read/write data. Currently, anyone with your URL can access the data. For production, you should enable RLS.

### 8.1 Open SQL Editor

Go to **SQL Editor** in Supabase dashboard.

### 8.2 Run RLS Policies

```sql
-- Enable RLS on tables
ALTER TABLE material_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_status_history ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access (for now)
CREATE POLICY "Allow public read access" ON material_links
    FOR SELECT
    USING (true);

-- Policy: Allow public write access (for now)
CREATE POLICY "Allow public write access" ON material_links
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow public update access" ON material_links
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow public delete access" ON material_links
    FOR DELETE
    USING (true);

-- Same for history table
CREATE POLICY "Allow public read history" ON material_status_history
    FOR SELECT
    USING (true);
```

### 8.3 Test After Enabling RLS

- Go back to Material Tracking page
- Refresh the page
- Create/update/delete links to verify everything still works

---

## Step 9: Add Authentication (Optional - For Production)

If you want to track who creates/updates links and restrict access:

### 9.1 Enable Email Authentication

1. Go to **Authentication** > **Providers**
2. Enable **Email** provider
3. Configure email templates (optional)

### 9.2 Update RLS Policies

```sql
-- Only authenticated users can write
CREATE POLICY "Authenticated users can write" ON material_links
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Only authenticated users can update their own links
CREATE POLICY "Users can update own links" ON material_links
    FOR UPDATE
    USING (auth.uid()::text = linked_by)
    WITH CHECK (auth.uid()::text = linked_by);
```

### 9.3 Update Frontend

You'll need to add login UI. See Supabase docs: https://supabase.com/docs/guides/auth

---

## Troubleshooting

### Error: "Supabase URL not configured"

**Problem:** Configuration file not updated

**Fix:**
1. Open `supabase-config.js`
2. Replace `YOUR_SUPABASE_URL_HERE` with your actual URL
3. Replace `YOUR_SUPABASE_ANON_KEY_HERE` with your actual key
4. Save and refresh the page

### Error: "Failed to load material links"

**Problem:** Database schema not created or RLS blocking access

**Fix:**
1. Check Table Editor - do tables exist?
2. If not, run the schema.sql script again
3. If RLS is enabled, check policies allow access

### Error: "relation 'material_links' does not exist"

**Problem:** Database schema not run

**Fix:**
1. Go to SQL Editor
2. Copy and paste entire contents of `supabase/schema.sql`
3. Run it
4. Refresh Material Tracking page

### Real-Time Updates Not Working

**Problem:** Real-time not enabled on table

**Fix:**
1. Go to **Database** > **Replication**
2. Find `material_links` table
3. Toggle **"Enable Replication"** ON
4. Refresh the page

### Slow Performance

**Problem:** Missing indexes or large dataset

**Fix:**
1. Indexes are created by schema.sql - verify they exist
2. Check **Database** > **Indexes** in Supabase
3. For large datasets (>10,000 rows), consider pagination

---

## Architecture Overview

### How It Works

```
┌─────────────────┐
│  Your Browser   │
│  (Dashboard)    │
└────────┬────────┘
         │
         │ HTTPS
         ▼
┌─────────────────┐
│  Supabase API   │
│  (Auto-generated)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  PostgreSQL DB  │
│  (Cloud Hosted) │
└─────────────────┘
```

### What Replaced What

| Old (Flask) | New (Supabase) |
|-------------|----------------|
| `backend/app.py` | Supabase Auto API |
| SQLite file | PostgreSQL Cloud DB |
| Manual CORS | Built-in CORS |
| Manual endpoints | Auto-generated REST |
| No real-time | Real-time subscriptions |
| Local server | Cloud hosted |

### Data Flow

1. **Frontend** → Supabase JS Client → **Supabase API**
2. **Supabase API** → Validates request → **PostgreSQL**
3. **PostgreSQL** → Returns data → **Supabase API**
4. **Supabase API** → **Frontend** (renders data)
5. **Real-time:** DB change → **Supabase Realtime** → **All connected clients**

---

## Supabase Dashboard Features

### Table Editor

- View/edit data directly
- Add/delete rows manually
- Export data to CSV
- Import data from CSV

### SQL Editor

- Run custom queries
- Save frequently-used queries
- View query history
- Create views and functions

### Database Settings

- Connection pooling
- Database backups (paid plans)
- Database migrations
- Connection strings (for direct PostgreSQL access)

### API Documentation

- Auto-generated API docs
- Try API endpoints in browser
- See request/response examples
- Copy cURL commands

### Monitoring

- Database size
- API requests
- Bandwidth usage
- Active connections

---

## Free Tier Limits

Your project will stay free as long as you don't exceed:

| Resource | Free Limit | Your Usage (estimated) |
|----------|------------|------------------------|
| **Database Size** | 500 MB | ~5 MB (plenty of room!) |
| **API Requests** | Unlimited | ✓ No limit |
| **Bandwidth** | 5 GB | ~100 MB (well under) |
| **Auth Users** | Unlimited | ✓ No limit |
| **Storage** | 1 GB | Not using storage |
| **Edge Functions** | 500K invocations | Not using functions |

**Bottom Line:** You won't hit the limits for this project.

---

## Backup and Export

### Manual Backup

1. Go to **Table Editor**
2. Select `material_links`
3. Click **"Export"** → CSV
4. Save the file

### Automated Backups

- **Free Tier:** No automated backups
- **Pro Tier ($25/month):** Daily backups with point-in-time recovery
- **Recommendation:** For now, export to CSV weekly

### Migration Export

If you ever want to move to another database:

```sql
-- Get full database dump
pg_dump --host=db.xxxxx.supabase.co \
        --username=postgres \
        --dbname=postgres \
        --clean \
        --file=backup.sql
```

---

## Security Best Practices

### ✅ Do This

- ✅ Enable RLS for production
- ✅ Use environment variables for keys (in production)
- ✅ Validate user input on frontend
- ✅ Set up authentication if sharing with team
- ✅ Regularly export backups
- ✅ Monitor usage in Supabase dashboard

### ❌ Don't Do This

- ❌ Share your database password
- ❌ Commit service role key to GitHub (only anon key is safe)
- ❌ Disable RLS without policies
- ❌ Allow SQL injection via unvalidated inputs
- ❌ Store sensitive data without encryption

---

## Next Steps

### Immediate

- [ ] Create Supabase account
- [ ] Create project
- [ ] Run schema.sql
- [ ] Update supabase-config.js
- [ ] Test the connection
- [ ] Create your first material link

### Soon

- [ ] Enable RLS policies
- [ ] Set up weekly data exports
- [ ] Add team members (if needed)
- [ ] Customize email templates (if using auth)

### Eventually

- [ ] Add user authentication
- [ ] Implement role-based access
- [ ] Set up automated reports
- [ ] Create custom views/queries

---

## Support Resources

### Supabase Documentation

- **Official Docs:** https://supabase.com/docs
- **JavaScript Client:** https://supabase.com/docs/reference/javascript
- **Database:** https://supabase.com/docs/guides/database
- **Auth:** https://supabase.com/docs/guides/auth
- **Realtime:** https://supabase.com/docs/guides/realtime

### Community

- **Discord:** https://discord.supabase.com
- **GitHub Discussions:** https://github.com/supabase/supabase/discussions
- **Twitter:** @supabase

### Your Project Documentation

- **MATERIAL_TRACKING_GUIDE.md** - Application usage guide
- **ARCHITECTURE.md** - System architecture (Flask version)
- **README.md** - Main project documentation

---

## Comparison: Flask vs. Supabase

| Feature | Flask (Old) | Supabase (New) |
|---------|-------------|----------------|
| **Setup Time** | 10 min | 15 min |
| **Server Required** | Yes (always on) | No (cloud) |
| **Cost** | Free (local) | Free (cloud) |
| **Scaling** | Manual | Automatic |
| **Backups** | Manual | Automated (paid) |
| **Real-time** | No | Yes ✓ |
| **Multi-user** | Limited | Yes ✓ |
| **API Docs** | Manual | Auto-generated ✓ |
| **Authentication** | Manual | Built-in ✓ |
| **Monitoring** | Manual | Dashboard ✓ |
| **Security** | DIY | RLS + Auth ✓ |

**Winner:** Supabase for almost everything except simplicity

---

## FAQ

**Q: Can I use both Flask and Supabase?**
A: Not recommended. Pick one. Supabase is better for most use cases.

**Q: Will I lose data if I go over free tier?**
A: No, Supabase will notify you. You can upgrade or reduce usage.

**Q: Can I switch back to Flask later?**
A: Yes! Export your data to CSV, import into SQLite, use old Flask backend.

**Q: Is my data secure?**
A: Yes. Supabase uses enterprise-grade security. Enable RLS for production.

**Q: Can I access the database with other tools?**
A: Yes! Get connection string from Settings → Database. Use with pgAdmin, TablePlus, etc.

**Q: What happens if Supabase goes down?**
A: Rare, but possible. Supabase has 99.9% uptime SLA. Keep weekly CSV backups.

**Q: Can I self-host Supabase?**
A: Yes! Supabase is open source. See: https://supabase.com/docs/guides/self-hosting

---

## Migration from Flask (If You Have Existing Data)

If you already have data in the Flask/SQLite backend:

### 1. Export from SQLite

```bash
cd backend
sqlite3 material_tracking.db

.mode csv
.output material_links.csv
SELECT * FROM material_links;
.quit
```

### 2. Import to Supabase

1. Go to **Table Editor** → `material_links`
2. Click **"Insert"** → **"Import data from CSV"**
3. Select your `material_links.csv` file
4. Map columns (should auto-detect)
5. Click **"Import"**

### 3. Verify

Check that all records imported correctly.

---

**Setup Complete!** 🎉

You now have a fully cloud-hosted material tracking system with:
- ✓ Real-time updates
- ✓ Automatic API
- ✓ Scalable database
- ✓ No server to maintain

**Next:** Start using the Material Tracking page to link PO items to installation items!

---

**Supabase Migration Version:** 1.0
**Last Updated:** January 15, 2026
**Project:** Frame 6B Power Group
**Contractor:** Relevant Power Solutions
