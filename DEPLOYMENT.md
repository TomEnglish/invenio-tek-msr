# MSR Dashboard - Netlify Deployment Guide

## Overview
This guide walks you through deploying the MSR Dashboard to Netlify as a static web application.

## Prerequisites
- Netlify account (free tier works fine)
- GitHub repository with your code
- Supabase project already set up and running

---

## Step 1: Prepare Your Repository

### Files to Include in Deployment:
```
✅ index.html
✅ gap-analysis.html
✅ material-tracking.html
✅ samsara-tracking.html
✅ material-tracking.js
✅ samsara-tracking.js
✅ supabase-config.js  (*** IMPORTANT - needs to be committed ***)
✅ RPS_Logoavif.avif
✅ netlify.toml
```

### Files to EXCLUDE (already in .gitignore):
```
❌ .env
❌ *.py (Python scripts)
❌ supabase/*.sql
❌ debug_*.py, test_*.py, check_*.py
❌ __pycache__/
```

### **IMPORTANT: Commit supabase-config.js**

The `supabase-config.js` file is currently in `.gitignore`, but it needs to be in your repository for Netlify to work. The Supabase anon key is **safe to expose publicly** - it's designed for client-side use.

**Option A: Remove from .gitignore and commit** (Recommended)

```bash
# Edit .gitignore and remove this line:
# supabase-config.js

# Then commit the file
git add supabase-config.js
git commit -m "Add supabase-config.js for Netlify deployment"
git push
```

**Option B: Use Netlify environment variables** (More complex)

If you prefer not to commit the config file, you can inject it at build time using Netlify environment variables (see Step 4).

---

## Step 2: Connect to Netlify

### Method 1: Deploy via Netlify UI (Easiest)

1. Go to https://app.netlify.com
2. Click **"Add new site"** → **"Import an existing project"**
3. Choose **"Deploy with GitHub"**
4. Authorize Netlify to access your GitHub
5. Select your repository: **`TomEnglish/MSR_F6B`**
6. Configure build settings:
   - **Branch to deploy:** `main`
   - **Build command:** (leave empty)
   - **Publish directory:** `.` (current directory)
7. Click **"Deploy site"**

### Method 2: Deploy via Netlify CLI

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Initialize site
netlify init

# Deploy
netlify deploy --prod
```

---

## Step 3: Verify Supabase Configuration

After deployment, open your Netlify site and check the browser console:

```javascript
// Should see:
✓ Supabase configuration validated
```

If you see errors, verify:
1. `supabase-config.js` was deployed
2. The file is loaded before other scripts in your HTML files
3. Supabase URL and anon key are correct

---

## Step 4: (Optional) Use Environment Variables

If you prefer not to commit `supabase-config.js`, you can use Netlify environment variables:

### In Netlify Dashboard:
1. Go to **Site settings** → **Environment variables**
2. Add variables:
   ```
   SUPABASE_URL=https://lmdomalnuzbvxxutpyky.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

### Create a build script (`build.sh`):
```bash
#!/bin/bash
# Generate supabase-config.js at build time
cat > supabase-config.js <<EOF
window.SUPABASE_CONFIG = {
    url: '${SUPABASE_URL}',
    anonKey: '${SUPABASE_ANON_KEY}',
    options: {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true
        },
        realtime: { enabled: true }
    }
};
EOF
```

Update `netlify.toml`:
```toml
[build]
  command = "bash build.sh"
  publish = "."
```

---

## Step 5: Set Up Python Sync Script (Backend)

The Python sync script (`sync_samsara_data.py`) **cannot run on Netlify** (it's a static host).

### Options for Running Python Sync:

#### Option A: Run Locally on Schedule
Set up Windows Task Scheduler to run `sync_samsara_data.py` every hour on your local machine:

```xml
<!-- Task Scheduler XML -->
<Task>
  <Triggers>
    <CalendarTrigger>
      <Repetition>
        <Interval>PT1H</Interval>
      </Repetition>
    </CalendarTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>python</Command>
      <Arguments>C:\Users\thomasenglish\Desktop\ProjectProgressandPO\sync_samsara_data.py</Arguments>
    </Exec>
  </Actions>
</Task>
```

#### Option B: Deploy to a Serverless Platform
- **Heroku** (free tier available)
- **Railway.app** (free tier)
- **Render.com** (free tier)
- **AWS Lambda** (pay-per-use)
- **Google Cloud Functions** (pay-per-use)

#### Option C: Use Supabase Edge Functions
Convert the sync script to a Supabase Edge Function (TypeScript/JavaScript) and trigger it via cron.

---

## Step 6: Configure Custom Domain (Optional)

### In Netlify Dashboard:
1. Go to **Domain settings** → **Add custom domain**
2. Enter your domain: `msr-dashboard.yourdomain.com`
3. Follow DNS configuration instructions
4. Enable HTTPS (Netlify provides free SSL via Let's Encrypt)

---

## Step 7: Test Your Deployment

### Checklist:
- [ ] Dashboard loads at your Netlify URL
- [ ] All navigation links work
- [ ] Material Tracking page loads data from Supabase
- [ ] Gap Analysis page loads data
- [ ] Samsara Tracking page shows tracker locations on map
- [ ] Filters work (search, status, hide unknown)
- [ ] Export to CSV works
- [ ] Real-time updates work (open in two browsers and test)
- [ ] Console shows no errors

### Common Issues:

**Issue: "Failed to load tracker data"**
- Check `supabase-config.js` is deployed
- Verify Supabase URL and anon key are correct
- Check browser console for CORS errors

**Issue: "Map doesn't load"**
- Verify Leaflet.js CDN is accessible
- Check browser console for JavaScript errors

**Issue: "Real-time updates not working"**
- Ensure Supabase Realtime is enabled in your project
- Check WebSocket connection in Network tab

---

## Step 8: Monitor and Maintain

### Netlify Dashboard:
- **Deploys**: View deployment history and logs
- **Functions**: Monitor serverless function usage (if using)
- **Analytics**: Track site traffic (available on paid plans)

### Supabase Dashboard:
- **Database**: Monitor table sizes and query performance
- **API**: Check API usage and rate limits
- **Logs**: View real-time logs for debugging

---

## Deployment Workflow

### Continuous Deployment (Automatic):
1. Make changes to your code
2. Commit and push to GitHub: `git push`
3. Netlify automatically rebuilds and deploys
4. Changes live in ~1 minute

### Manual Deployment:
```bash
# Deploy preview (test environment)
netlify deploy

# Deploy to production
netlify deploy --prod
```

---

## Security Notes

### Safe to Expose (Public):
✅ Supabase URL
✅ Supabase Anon Key (designed for client-side use)
✅ All HTML/CSS/JS files

### Must Keep Secret (Private):
❌ `.env` file (contains Samsara API token)
❌ Supabase Service Role Key (never use in frontend)
❌ Any database passwords

### Row Level Security (RLS):
Ensure Supabase tables have proper RLS policies:

```sql
-- Allow public read access
CREATE POLICY "Allow public read access to trackers"
ON samsara_trackers FOR SELECT
USING (true);

-- Only allow server-side writes
CREATE POLICY "Deny public write access"
ON samsara_trackers FOR INSERT
USING (false);
```

---

## Troubleshooting

### Build Fails
- Check Netlify deploy logs
- Ensure all required files are in repository
- Verify `netlify.toml` syntax

### Site Loads but No Data
- Check browser console for errors
- Verify Supabase credentials
- Test Supabase connection directly

### Sync Script Not Running
- Ensure Python environment has all dependencies
- Check `.env` file has correct credentials
- Review script logs for errors

---

## Cost Estimate

### Free Tier Limits:
- **Netlify**: 100GB bandwidth/month, 300 build minutes/month
- **Supabase**: 500MB database, 2GB bandwidth, 50,000 monthly active users
- **Samsara API**: (depends on your plan)

### Expected Usage:
- Dashboard pageviews: ~1MB per load
- Supabase API calls: ~10-50 per page load
- Sync script: ~1-5 API calls per hour

**You should stay well within free tier limits** for a small team dashboard.

---

## Support

### Resources:
- Netlify Docs: https://docs.netlify.com
- Supabase Docs: https://supabase.com/docs
- Samsara API Docs: https://developers.samsara.com

### Need Help?
1. Check browser console for errors
2. Review Netlify deploy logs
3. Check Supabase logs
4. Test API endpoints directly

---

## Next Steps After Deployment

1. ✅ Set up automated sync script (hourly)
2. ✅ Configure custom domain (optional)
3. ✅ Add user authentication (if needed)
4. ✅ Implement tracker-to-material linking in GUI
5. ✅ Set up monitoring/alerts for sync failures
6. ✅ Create user documentation

---

**Deployment Complete!** 🎉

Your MSR Dashboard should now be live and accessible to your team.
