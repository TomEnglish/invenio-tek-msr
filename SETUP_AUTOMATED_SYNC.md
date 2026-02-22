# Automated Samsara Sync Setup Guide

## Overview
This guide will help you set up automated hourly syncing of Samsara tracker data to Supabase using Windows Task Scheduler.

---

## Option 1: Windows Task Scheduler (Recommended for Local Machine)

### Step 1: Test the Batch File

First, verify the sync script works:

```cmd
cd C:\Users\thomasenglish\Desktop\ProjectProgressandPO
sync_samsara.bat
```

You should see output in `logs\sync_YYYYMMDD_HHMMSS.log`

### Step 2: Create Scheduled Task

#### Method A: Using Task Scheduler GUI (Easiest)

1. **Open Task Scheduler**
   - Press `Win + R`
   - Type `taskschd.msc`
   - Press Enter

2. **Create Basic Task**
   - Click **"Create Basic Task"** in the right panel
   - Name: `Samsara Data Sync`
   - Description: `Sync Samsara tracker data to Supabase every hour`
   - Click **Next**

3. **Set Trigger**
   - Select **"Daily"**
   - Click **Next**
   - Start date: Today
   - Recur every: **1 days**
   - Click **Next**

4. **Set Action**
   - Select **"Start a program"**
   - Click **Next**
   - Program/script: `C:\Users\thomasenglish\Desktop\ProjectProgressandPO\sync_samsara.bat`
   - Start in: `C:\Users\thomasenglish\Desktop\ProjectProgressandPO`
   - Click **Next**

5. **Configure Advanced Settings**
   - Check **"Open the Properties dialog for this task when I click Finish"**
   - Click **Finish**

6. **In the Properties Dialog:**
   - Go to **Triggers** tab → **Edit**
   - Check **"Repeat task every:"** → Select **1 hour**
   - For a duration of: **Indefinitely**
   - Click **OK**

   - Go to **Settings** tab:
     - ✅ Check "Run task as soon as possible after a scheduled start is missed"
     - ✅ Check "If the task fails, restart every: 5 minutes, Attempt to restart up to: 3 times"
     - ❌ Uncheck "Stop the task if it runs longer than: 3 days"
     - Click **OK**

#### Method B: Using PowerShell (Advanced)

Run PowerShell as Administrator and execute:

```powershell
# Create scheduled task
$action = New-ScheduledTaskAction `
    -Execute "C:\Users\thomasenglish\Desktop\ProjectProgressandPO\sync_samsara.bat" `
    -WorkingDirectory "C:\Users\thomasenglish\Desktop\ProjectProgressandPO"

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName "Samsara Data Sync" `
    -Description "Sync Samsara tracker data to Supabase every hour" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal
```

### Step 3: Verify Task is Running

1. Open Task Scheduler
2. Find "Samsara Data Sync" in the task list
3. Right-click → **Run** to test
4. Check `logs\` folder for new log files
5. Verify data appears in Supabase

### Step 4: Monitor Logs

Check sync logs periodically:

```cmd
cd C:\Users\thomasenglish\Desktop\ProjectProgressandPO\logs
dir /o-d
type sync_20260116_090000.log
```

---

## Option 2: Cloud-Based Sync (For Always-On Operation)

If your local machine isn't always running, deploy the sync script to a cloud platform:

### A. Railway.app (Recommended - Easy + Free Tier)

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway**
   ```bash
   railway login
   ```

3. **Create Railway Project**
   ```bash
   cd C:\Users\thomasenglish\Desktop\ProjectProgressandPO
   railway init
   ```

4. **Create `railway.json`**
   ```json
   {
     "build": {
       "builder": "NIXPACKS"
     },
     "deploy": {
       "startCommand": "python sync_samsara_data.py",
       "restartPolicyType": "ON_FAILURE",
       "restartPolicyMaxRetries": 3
     }
   }
   ```

5. **Create `requirements.txt`**
   ```
   requests==2.31.0
   python-dotenv==1.0.0
   ```

6. **Deploy**
   ```bash
   railway up
   ```

7. **Set Environment Variables in Railway Dashboard**
   - `SAMSARA_API_TOKEN`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

8. **Set up Cron Job (Railway)**
   - Railway doesn't have built-in cron
   - Use external service like **Cron-job.org** to trigger Railway endpoint hourly

### B. Render.com (Easy Setup)

1. **Create `render.yaml`**
   ```yaml
   services:
     - type: cron
       name: samsara-sync
       env: python
       schedule: "0 * * * *"  # Every hour
       buildCommand: "pip install -r requirements.txt"
       startCommand: "python sync_samsara_data.py"
       envVars:
         - key: SAMSARA_API_TOKEN
           sync: false
         - key: SUPABASE_URL
           sync: false
         - key: SUPABASE_ANON_KEY
           sync: false
   ```

2. **Push to GitHub**
3. **Connect repository to Render**
4. **Set environment variables in Render dashboard**

### C. Heroku (Classic Option)

1. **Install Heroku CLI**
   ```bash
   npm install -g heroku
   ```

2. **Create `Procfile`**
   ```
   worker: python sync_samsara_data.py
   ```

3. **Create `runtime.txt`**
   ```
   python-3.11
   ```

4. **Deploy**
   ```bash
   heroku create msr-samsara-sync
   heroku config:set SAMSARA_API_TOKEN=your_token
   heroku config:set SUPABASE_URL=your_url
   heroku config:set SUPABASE_ANON_KEY=your_key
   git push heroku main
   ```

5. **Add Heroku Scheduler**
   ```bash
   heroku addons:create scheduler:standard
   heroku addons:open scheduler
   ```
   - Add job: `python sync_samsara_data.py`
   - Frequency: Every hour

### D. AWS Lambda (Serverless - Most Cost Effective)

1. **Create Lambda function** via AWS Console
2. **Upload code** as ZIP file
3. **Set environment variables**
4. **Add EventBridge trigger** (cron: `0 * * * ? *`)
5. **Configure timeout** to 5 minutes

---

## Option 3: Supabase Edge Functions (Native Integration)

Convert the Python script to a TypeScript Edge Function:

### Step 1: Install Supabase CLI

```bash
npm install -g supabase
```

### Step 2: Create Edge Function

```bash
supabase functions new sync-samsara
```

### Step 3: Write Function Code

```typescript
// supabase/functions/sync-samsara/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  try {
    const SAMSARA_API_TOKEN = Deno.env.get('SAMSARA_API_TOKEN')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')

    // Fetch from Samsara API
    const response = await fetch('https://api.samsara.com/fleet/assets', {
      headers: {
        'Authorization': `Bearer ${SAMSARA_API_TOKEN}`,
        'Accept': 'application/json'
      }
    })

    const data = await response.json()

    // Write to Supabase
    const supabaseResponse = await fetch(`${SUPABASE_URL}/rest/v1/samsara_trackers`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }
})
```

### Step 4: Deploy

```bash
supabase functions deploy sync-samsara
```

### Step 5: Set up Cron (via pg_cron in Supabase)

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule hourly sync
SELECT cron.schedule(
    'sync-samsara-hourly',
    '0 * * * *',  -- Every hour at minute 0
    $$
    SELECT net.http_post(
        url:='https://your-project.supabase.co/functions/v1/sync-samsara',
        headers:='{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
    );
    $$
);
```

---

## Monitoring & Troubleshooting

### Check Task Status (Windows)

```powershell
Get-ScheduledTask -TaskName "Samsara Data Sync" | Get-ScheduledTaskInfo
```

### View Recent Logs

```cmd
cd C:\Users\thomasenglish\Desktop\ProjectProgressandPO\logs
dir /o-d /b | more
```

### Manual Sync Test

```cmd
cd C:\Users\thomasenglish\Desktop\ProjectProgressandPO
python sync_samsara_data.py
```

### Common Issues

**Issue: Task runs but no data updates**
- Check logs in `logs\` folder
- Verify `.env` file has correct credentials
- Test sync manually

**Issue: Task doesn't run**
- Ensure computer is not sleeping
- Check Task Scheduler history (View → Show Task History)
- Verify user has permissions

**Issue: Sync fails with API error**
- Check Samsara API token is valid
- Verify API rate limits not exceeded
- Review Samsara API status page

---

## Recommendations

**For Development/Testing:**
- ✅ Use Windows Task Scheduler (local machine)
- ✅ Easy to set up and monitor
- ✅ Free (uses your existing machine)

**For Production:**
- ✅ Use cloud platform (Railway, Render, Heroku)
- ✅ Always-on operation
- ✅ Better reliability
- ✅ Email notifications on failure

**Best Overall:**
- ✅ **Supabase Edge Functions** (native integration, serverless, built-in cron)
- ✅ **Render.com** (easiest cloud setup with built-in cron)
- ✅ **Railway.app** (free tier, good developer experience)

---

## Next Steps

1. ✅ Choose your deployment method
2. ✅ Set up automated sync
3. ✅ Monitor logs for first 24 hours
4. ✅ Verify data updates in Netlify dashboard
5. ✅ Set up failure notifications (email/Slack)

---

**Questions?** Check the logs first, then review the troubleshooting section above.
