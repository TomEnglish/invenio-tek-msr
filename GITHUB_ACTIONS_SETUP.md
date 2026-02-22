# GitHub Actions - Automated Samsara Sync Setup

## Overview
This guide shows you how to use GitHub Actions to automatically sync Samsara data to Supabase every hour - completely free and cloud-based!

---

## How It Works

1. **GitHub Actions** runs your sync script in the cloud (free for public repos)
2. **Scheduled cron job** triggers every hour at :00
3. **Secrets** store your API credentials securely
4. **No local machine needed** - runs 24/7 automatically

---

## Setup Instructions

### Step 1: Add GitHub Secrets

GitHub Actions needs your API credentials. Let's add them as secrets:

1. **Go to your GitHub repository**
   - Navigate to: https://github.com/TomEnglish/MSR_F6B

2. **Open Settings → Secrets and variables → Actions**
   - Click on **"Settings"** (top menu)
   - Click **"Secrets and variables"** (left sidebar)
   - Click **"Actions"**

3. **Add the following secrets**

   Click **"New repository secret"** for each:

   **Secret 1:**
   - Name: `SAMSARA_API_TOKEN`
   - Value: `<your_samsara_api_token>`

   **Secret 2:**
   - Name: `SUPABASE_URL`
   - Value: `https://lmdomalnuzbvxxutpyky.supabase.co`

   **Secret 3:**
   - Name: `SUPABASE_ANON_KEY`
   - Value: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtZG9tYWxudXpidnh4dXRweWt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MDk1NDYsImV4cCI6MjA4MzM4NTU0Nn0.KnNiJbimuuzgmelZJSXLhJ60SM6fYi8XhPLZe8AEPbs`

---

### Step 2: Push the Workflow File

The workflow file `.github/workflows/sync-samsara.yml` has been created. Now commit and push it:

```bash
cd C:\Users\thomasenglish\Desktop\ProjectProgressandPO
git add .github/workflows/sync-samsara.yml
git add GITHUB_ACTIONS_SETUP.md
git commit -m "Add GitHub Actions workflow for automated Samsara sync"
git push
```

---

### Step 3: Verify the Workflow

1. **Go to your GitHub repository**
2. Click the **"Actions"** tab
3. You should see **"Sync Samsara Data"** workflow listed
4. Click on it to view details

---

### Step 4: Test the Workflow Manually

Before waiting for the hourly schedule, test it now:

1. **Go to Actions tab** in your GitHub repo
2. Click **"Sync Samsara Data"** workflow
3. Click **"Run workflow"** button (top right)
4. Select branch: `main`
5. Click **"Run workflow"**
6. Wait ~1 minute for it to complete
7. Check the logs by clicking on the workflow run

You should see:
```
✓ Sync completed successfully
Trackers fetched: 50
Trackers updated: 50
Locations added: 24
```

---

### Step 5: Verify Data in Netlify Dashboard

1. Open your Netlify site
2. Go to Samsara Tracking page
3. Check that tracker data is up to date
4. Look at "Last Synced" timestamp

---

## Workflow Configuration

### Current Schedule
- **Runs:** Every hour at :00 (e.g., 1:00, 2:00, 3:00...)
- **Cron:** `0 * * * *`

### To Change the Schedule

Edit `.github/workflows/sync-samsara.yml`:

**Every 30 minutes:**
```yaml
- cron: '*/30 * * * *'
```

**Every 15 minutes:**
```yaml
- cron: '*/15 * * * *'
```

**Every 2 hours:**
```yaml
- cron: '0 */2 * * *'
```

**Only during business hours (8am-6pm CT):**
```yaml
- cron: '0 8-18 * * *'
```

**Custom schedule:**
Use https://crontab.guru to build your cron expression

---

## Monitoring

### View Workflow Runs

1. Go to **Actions** tab in GitHub
2. Click on **"Sync Samsara Data"**
3. See history of all runs (success/failure)

### Email Notifications

GitHub automatically emails you if a workflow fails. To customize:

1. Go to **Settings** → **Notifications**
2. Under **Actions**, configure email preferences

### Check Logs

Click on any workflow run to see detailed logs:
- Python output
- Sync statistics
- Error messages (if any)

---

## Troubleshooting

### Workflow Not Running

**Check:**
- Workflow file is in `.github/workflows/` folder
- File is named with `.yml` extension
- Repository has Actions enabled (Settings → Actions → Allow all actions)

### Workflow Fails with "Secret not found"

**Fix:**
- Verify secrets are added in Settings → Secrets → Actions
- Secret names must match exactly: `SAMSARA_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- No spaces in secret names

### Workflow Fails with "Module not found"

**Fix:**
- Ensure `requests` and `python-dotenv` are in the install step
- Check Python version is 3.11 or higher

### Sync Runs but Data Not Updated

**Check:**
- View workflow logs for errors
- Verify Supabase credentials are correct
- Test sync script locally to isolate issue
- Check Supabase database for write permissions

---

## GitHub Actions Limits (Free Tier)

### Public Repositories (Your MSR_F6B repo)
- ✅ **Unlimited** minutes per month
- ✅ **Unlimited** storage
- ✅ **Unlimited** concurrent jobs

### Private Repositories
- ⚠️ 2,000 minutes per month (free tier)
- Each workflow run uses ~1-2 minutes
- Hourly schedule = ~720 runs/month = ~1,440 minutes
- You'd stay within limits even for private repos

**Your repo is public, so you have unlimited usage!** 🎉

---

## Advantages of GitHub Actions

✅ **Free** (for public repos)
✅ **Cloud-based** (no local machine needed)
✅ **Reliable** (runs 24/7)
✅ **Easy to monitor** (web UI with logs)
✅ **Email notifications** on failures
✅ **Version controlled** (workflow is in Git)
✅ **No infrastructure** to manage

---

## Alternative: Local Task Scheduler

If you prefer to run sync locally, see `SETUP_AUTOMATED_SYNC.md` for Windows Task Scheduler setup.

**Comparison:**

| Feature | GitHub Actions | Local Task Scheduler |
|---------|---------------|---------------------|
| Cost | Free | Free |
| Reliability | High (cloud) | Depends on PC |
| Setup Complexity | Low | Medium |
| Requires PC Running | No | Yes |
| Logs/Monitoring | Web UI | Local files |
| Notifications | Email | Custom setup |

---

## Next Steps

1. ✅ Add GitHub secrets
2. ✅ Push workflow file
3. ✅ Test manual run
4. ✅ Verify data updates
5. ✅ Monitor for 24 hours
6. ✅ Enjoy automated syncing! 🚀

---

## Questions?

- **GitHub Actions Docs:** https://docs.github.com/en/actions
- **Cron Syntax:** https://crontab.guru
- **Workflow Logs:** Check Actions tab in your repo
