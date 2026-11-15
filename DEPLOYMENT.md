# Invenio Field MSR - Netlify Deployment Guide

## Overview
This guide walks you through deploying the Invenio Field MSR to Netlify as a static web application.

## Prerequisites
- Netlify account (free tier works fine)
- GitHub repository with your code
- Supabase project already set up and running

---

## Step 1: Connection settings come from the environment

> Each site is one **environment** (dev, demo, or a customer); see [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md). That page is the current guide. The rest of this file is older background on the web host.

`supabase-config.js` is **not** committed and is not edited by hand. `scripts/build-site.mjs` writes it into `dist/` for the environment the site belongs to, taken from `environments.json`:

- On the web host the build recognizes the site by the address it is publishing to. No site settings are needed.
- Anywhere else, name the environment: `APP_ENV=dev node scripts/build-site.mjs`.
- A build with no environment, or for an address that is not in `environments.json`, fails. The site keeps its last publication.

Only browser assets are published (`netlify.toml` runs the build and publishes `dist/`). Spreadsheets, SQL, scripts and `environments.json` itself are not.

---

## Step 2: Connect to Netlify

### Method 1: Deploy via Netlify UI (Easiest)

1. Go to https://app.netlify.com
2. Click **"Add new site"** → **"Import an existing project"**
3. Choose **"Deploy with GitHub"**
4. Authorize Netlify to access your GitHub
5. Select your repository: **`TomEnglish/invenio-tek-msr`**
6. Configure build settings:
   - **Branch to deploy:** `main`
   - **Build command** and **Publish directory:** leave as detected; `netlify.toml` sets them (`node scripts/build-site.mjs`, `dist`)
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

The console should show no errors, and `/release.json` on the site should name the commit and the environment it was built for.

If the build failed with "No environment in environments.json is published at …", the site's address has no entry yet: add it to `environments.json` (see `docs/ENVIRONMENTS.md`).

---

## Step 4: Settings on the web host

None are needed. The build takes everything from `environments.json`. `APP_ENV` may be set on a site to name its environment outright; the build refuses if that disagrees with the site's address.

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
      <Arguments><repo-folder>\sync_samsara_data.py</Arguments>
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

> **Change `environments.json` first.** The build recognizes a site by its address. Before adding a domain, set that environment's `siteUrl` to the new address and follow "Changing a site's address" in [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md). Otherwise the site's builds fail until it matches.

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
- Check `/supabase-config.js` on the site names this environment and its database
- Verify the entry in `environments.json` is correct
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

Your Invenio Field MSR should now be live and accessible to your team.
