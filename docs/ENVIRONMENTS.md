# Environments

One code base runs as several **environments**. An environment is a complete, separate copy of the system: its own database (tables, file stores, users, backups), its own office site address, and its own sign-in and email settings. The code is the same in every environment; only its settings differ.

| Kind | What it is for | Data |
| --- | --- | --- |
| `dev` | Building and trying changes | Sample data |
| `production` | The demo system, and one per customer | Live data, starts empty |

A customer's data lives only in that customer's database. There is no default connection anywhere in the code, so a site or app with no environment stops instead of reaching some other environment's data. The checks below catch the mistakes that would mix two environments; each one's limits are stated with it.

## The list: `environments.json`

Every environment has one entry. The file holds **public values only**.

| Field | Meaning |
| --- | --- |
| `kind` | `dev` or `production` |
| `label` | Short name. A `dev` site shows it on every page so sample data is never mistaken for live data. |
| `siteUrl` | The office site's address: `https` (plain `http` only for a site on this computer), lowercase, no path, no trailing slash |
| `databaseUrl` | That environment's database address, written the same way |
| `publicKey` | The database's browser key (anon or publishable) |
| `defaultProjectId` | The starter project created by the migrations |

Optional top-level `previews` names a `dev` environment for the web host's preview builds (see below).

`node scripts/environments.mjs check` validates the file; the test suite does the same. It refuses:

- two entries that share a site, a database or a key, however they are spelled (the same project under another domain, or `localhost` and `127.0.0.1`);
- a server key in `publicKey`;
- a legacy (JWT) browser key that names a different database than `databaseUrl`, or names none.

A publishable key (`sb_publishable_…`) names no database, so it cannot be matched to `databaseUrl` by reading it. It is checked only for reuse between entries; the release check below is what confirms the site really reaches its own database.

**Secrets never go in this file.** Each environment's server key and other secrets stay in that environment's secret store.

## How each part learns its environment

| Part | Setting | Where it is set |
| --- | --- | --- |
| Office site | `supabase-config.js`, written by `scripts/build-site.mjs` | The build is for the environment named by `APP_ENV`, or the one whose `siteUrl` is the address the web host says it is publishing to (`URL`). With both, they must agree. With neither, or an unknown address or name, the build fails and the site keeps its last publication. |
| Admin function (`admin-users`) | `SITE_URL` | The function's own settings, per database. It answers only that site and sends invitation links only to it. Without it the function answers nothing. |
| Invitation and reset emails | `supabase/templates/*.html` with a `%SITE_URL%` placeholder | `node scripts/environments.mjs templates <name>` writes the finished HTML for that environment's sign-in settings. |
| Scheduled jobs | Workflow matrix from `environments.mjs matrix` | Each job runs once per production. See "Secrets for scheduled jobs" below. |
| Phone app | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_OFFICE_SITE_URL` | The build service's environment variables. `scripts/check-release-env.cjs` in the app repository refuses to pass unless the office site named connects to the database named. It is run by hand. |

`supabase-config.js` is no longer committed. To open pages straight from this folder, write a local copy:

```bash
node scripts/environments.mjs config dev
```

### Preview builds

The web host also builds previews of pull requests. A preview is published under the same site, so by default it uses **that site's own environment**: previews of the demo site read and write the demo database, as they always have. Once a dev environment exists, set `"previews": "<dev name>"` at the top of `environments.json` and every site's previews use dev instead.

### Secrets for scheduled jobs

Each run of the license-removal job names the repository environment of its production (Settings > Environments > `<name>`) and reads `SUPABASE_SERVICE_ROLE_KEY`. The code host hands the job that environment's secret when it has one and **otherwise the repository-wide secret of the same name**, which today is demo's. So:

- demo works with no repository environment of its own;
- every other production **must** be given its own `SUPABASE_SERVICE_ROLE_KEY` in its repository environment;
- before anything is sent, the job reads the key: a legacy (JWT) key that names a different database stops the run with nothing sent. A new-style key (`sb_secret_…`) names no database and cannot be checked this way, so the repository environment's own secret is the only safeguard for those.

### Changing a site's address

The build recognizes a site by its address. Before giving a site a new address (a custom domain, for example), change `siteUrl` in `environments.json`, then the admin function's `SITE_URL`, the sign-in settings and email templates, and the phone app's `EXPO_PUBLIC_OFFICE_SITE_URL`. Until `siteUrl` matches, that site's builds fail and it keeps its last publication.

## Checks that keep environments apart

- **Tests** (`tests/environments.test.js`): no environment's site or database address appears in code outside `environments.json`; the browser client has no fallback connection.
- **After each merge to `main`** (`scripts/smoke-deploy.mjs --all`): every listed site must serve the released commit, say it was built for its own environment, and name its own database and no other listed one.
- **Database commands** (`scripts/database.sh`): each first confirms `DATABASE_URL` is that environment's own database. Only two forms are accepted for a hosted database: its direct address (`db.<its host>`), or the database host's shared pooler with the project named in the user. Any other host, a list of hosts, and connection options or shell settings that would send the command elsewhere are refused. For an environment whose database runs on this computer, it can only confirm the connection is local. Neither command can destroy data: `build` works only on an empty database, and `sample-data` only adds rows.
- **Server keys** (`scripts/create-first-admin.mjs`, the license job): a legacy key that names another database is refused before it is sent.
- **Schema** (`scripts/database.sh check <name>`): compares a database with a fresh build of the migrations, line by line, including which tables report live changes.

## Setting up a new environment

The same steps set up dev and, later, each customer. Do them in this order.

1. **Create the database** with the database host, then note its address, browser key and direct connection string.
2. **Add the entry to `environments.json` on a branch** and open a pull request. Run the commands below from that branch; merge it at step 7.
3. **Build the database from the migrations.** This works only on a new, empty database, records every migration, and ends by confirming the result matches a fresh build. If it stops part-way, delete the database, create it again and rerun.
   ```bash
   DATABASE_URL='postgres://…' scripts/database.sh build <name>
   ```
4. **Sign-in settings** for that database: site address = `siteUrl`; allowed redirects `<siteUrl>/login.html` and `<siteUrl>/login.html?setup=invite`; email link expiry 3600 seconds; the email sender; and the two templates from `node scripts/environments.mjs templates <name>` (invitation and password reset).
5. **Admin function.** Set its settings first, then deploy it:
   ```bash
   supabase secrets set SITE_URL=<siteUrl> INVITATION_TTL_SECONDS=3600 INVITATION_EMAIL_ENABLED=true --project-ref <ref>
   supabase functions deploy admin-users --project-ref <ref>
   ```
6. **Office site.** Create a site on the web host that publishes this repository's `main` at `siteUrl`. It needs no settings of its own. Until the entry is on `main` its build fails and nothing is published, which is expected.
7. **Merge the pull request.** The site now builds, and the release check on `main` starts covering it. For a production, first add a repository environment named `<name>` holding that database's `SUPABASE_SERVICE_ROLE_KEY`.
8. **First administrator.** A new database has no users, and everyone else is invited from Users & Access by an administrator. This command creates the first one and emails their invitation. It works only while the database has no active administrator; run it again to resend, or with another email to withdraw the first invitation and send a new one.
   ```bash
   SUPABASE_SERVICE_ROLE_KEY=… node scripts/create-first-admin.mjs <name> lead@example.com "Full Name"
   ```
9. **Dev only: sample data.** Three projects with yard records, inventory, outside shops, shop contacts, shipments and a schedule, written in the administrator's name (the one who has finished setup, or whose invitation is outstanding; never a withdrawn one). Only that person is added to the sample projects. It only adds rows: each part loads when its tables are empty and is skipped when they hold anything, so it never deletes or overwrites work done in dev. For a clean baseline, start a new dev database.
   ```bash
   DATABASE_URL='postgres://…' scripts/database.sh sample-data <name>
   ```
10. **Phone app.** Set the three `EXPO_PUBLIC_…` variables for the build profile that serves this environment, then run the app repository's `npm run release:check` for that profile.

## Bringing demo onto this (one time)

Demo was the only environment before this page existed. After the change that introduced environments is merged:

1. The web host rebuilds the demo site from `environments.json`. Nothing else is needed for the site.
2. Apply migrations `028` and `029` to the demo database, then run `scripts/database.sh check demo`. If demo already reports live changes for tables beyond the 13 in `028`, the check shows them as a difference to settle with a follow-up migration.
3. Before the next deploy of `admin-users`, set `SITE_URL` to demo's `siteUrl` on the function. The version deployed before this change keeps working without it; the new version answers nothing until it is set.
4. Add `EXPO_PUBLIC_OFFICE_SITE_URL` to the phone app's build profiles before the next app update is published.
5. The sign-in email templates need no change: rendered for demo they are identical to what is in place.

## Rules

- **No customer-specific code.** A difference between customers is a setting stored in that customer's database, never a branch or a copy of the code.
- **Schema changes are migrations.** Nothing is changed by hand in any environment; `scripts/database.sh check` shows it if someone does.
- **Dev first.** A change runs on dev before it reaches any production.
- **A table a page listens to for live changes** must be added to the publication by a migration (see `028_live_updates.sql`); `tests/live-updates.test.js` fails otherwise.

## Not automated yet

- Applying new migrations and deploying the admin function to every production in one release run, with a sameness check across them. Today a merge to `main` publishes every listed site at once, dev and productions alike.
- Applying sign-in settings from a script (step 4 is by hand).
- Running the phone app's settings check as part of publishing.
- The tracker sync, which still runs from a legacy repository with no per-environment setup (`docs/INTEGRATION_OWNERSHIP.md`).
