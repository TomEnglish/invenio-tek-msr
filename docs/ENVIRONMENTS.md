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
| Admin function (`admin-users`) | `SITE_URL` | The function's own settings, per database. It answers only that site and sends invitation links only to it. Without it the function answers nothing. A deploy by the release routine writes it from `siteUrl` first. |
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
- **At every release** (`scripts/release.mjs check <name>`, see "Releasing"): the site must serve the released commit, say it was built for its own environment, and name its own database and no other listed one; the admin function must answer only that site and be that commit's version; the database's history must be exactly the migration files and its schema must match a fresh build.
- **Every day** (the "Environments check" workflow): the same check for every environment, against the commit its site publishes. A change made by hand in one environment shows up here.
- **Database commands** (`scripts/database.sh`): each first confirms `DATABASE_URL` is that environment's own database. Only two forms are accepted for a hosted database: its direct address (`db.<its host>`), or the database host's shared pooler with the project named in the user. Any other host, a list of hosts, and connection options or shell settings that would send the command elsewhere are refused. For an environment whose database runs on this computer, it can only confirm the connection is local. Neither command can destroy data: `build` works only on an empty database, and `sample-data` only adds rows.
- **Server keys** (`scripts/create-first-admin.mjs`, the license job): a legacy key that names another database is refused before it is sent.
- **Schema and history** (`scripts/database.sh check <name>`): the recorded history must be exactly the migration files (same numbers, names and text), and the schema is compared with a fresh build of them, line by line, including which tables report live changes.

## Releasing

A release moves one commit of `main` onto an environment: its database, then its admin function, then its office site. It ends by confirming all three are at that commit. The same routine, `scripts/release.mjs release <name>`, runs for every environment.

| Environment | Released | Its site publishes |
| --- | --- | --- |
| `dev` | By every merge to `main`, after the quality checks pass | `main` |
| A production | On request, by the "Release to production" workflow: one production, or each in turn in the order of `environments.json` | Its own branch, `release/<name>` |

**Dev first is enforced.** A production release starts only when every dev environment is entirely at the same commit: site, admin function and database. A production's site cannot get ahead some other way, because the web host publishes it from `release/<name>` and only the routine moves that branch, and only forward along `main`.

What the routine does, in order:

1. **Database.** `scripts/database.sh migrate <name>` applies the migrations the database does not have yet. It first confirms the history recorded so far is exactly the first migration files; a migration edited after it ran, or a change applied by hand, stops the release before anything is applied. Each migration and its history record are one transaction, so an interrupted run leaves a migration either fully in or not there at all.
2. **Admin function.** When the job holds a deploy token, the function's `SITE_URL` is written from `environments.json` and the function is deployed. Nothing is sent when the environment already runs this version. Without a token the function is only checked, and the release fails if it is not this commit's version.
3. **Site.** For a production, `release/<name>` is moved to the commit and the web host publishes it. Dev's site is already publishing `main`.
4. **Check.** `scripts/release.mjs check <name>` (see "Checks that keep environments apart").

The database goes first because new pages may need new tables. If a later step fails, the production keeps its last site with the newer database until the release is run again. So **a migration must work with the site that is already published**: add in one release; remove what the old site used only in a later one.

The admin function tells anyone which version it is (the `X-Function-Release` header, a checksum of its source written by `node scripts/release.mjs stamp`). The check trusts that header; it does not read the deployed code.

### Secrets

Each environment has a repository environment of the same name (Settings > Environments) holding its own secrets. A job only ever receives the secrets of the one environment it names.

| Secret | Where | Used for |
| --- | --- | --- |
| `DATABASE_URL` | Each environment | Applying migrations and checking the database. Use the session pooler connection string (port 5432, user `postgres.<project>`); the code host's runners cannot reach the direct address. Every command first confirms the string is that environment's own database. |
| `SUPABASE_ACCESS_TOKEN` | Each environment, optional | Deploying the admin function. This token reaches everything its account can reach, so store one only from an account that belongs to this system's organization and no other. Otherwise leave it out and deploy by hand when the function changes: `SUPABASE_ACCESS_TOKEN=… node scripts/release.mjs function <name>`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Each production | The license-removal job (see "Secrets for scheduled jobs"). |
| `RELEASE_DEPLOY_KEY` | Repository | A write deploy key for this repository only. The release job uses it to move `release/<name>`; the workflow's own token is not allowed to push a commit that changes a workflow file. |

Until an environment's `DATABASE_URL` is stored, a merge still releases to dev but says, as a warning, that the database was neither migrated nor checked. A production is never released without its database.

### By hand

The workflows only call the scripts, so a release can be run from a checkout of `main` with the same secrets in the shell:

```bash
DATABASE_URL='postgres://…' node scripts/release.mjs release <name>
DATABASE_URL='postgres://…' node scripts/release.mjs check <name>     # read-only
```

Run by hand, a production release still refuses unless every dev site and dev admin function is at the commit. Only the workflow also checks the dev databases first.

## Setting up a new environment

The same steps set up dev and, later, each customer. Do them in this order.

1. **Create the database** with the database host, then note its address, browser key and direct connection string.
2. **Add the entry to `environments.json` on a branch** and open a pull request. Run the commands below from that branch; merge it at step 8.
3. **Build the database from the migrations.** This works only on a new, empty database, records every migration, and ends by confirming the result matches a fresh build. If it stops part-way, delete the database, create it again and rerun.
   ```bash
   DATABASE_URL='postgres://…' scripts/database.sh build <name>
   ```
4. **Sign-in settings** for that database: site address = `siteUrl`; allowed redirects `<siteUrl>/login.html` and `<siteUrl>/login.html?setup=invite`; email link expiry 3600 seconds; the email sender; and the two templates from `node scripts/environments.mjs templates <name>` (invitation and password reset).
5. **Admin function.** Set its invitation settings, then deploy it. The deploy writes `SITE_URL` from the entry.
   ```bash
   supabase secrets set INVITATION_TTL_SECONDS=3600 INVITATION_EMAIL_ENABLED=true --project-ref <ref>
   SUPABASE_ACCESS_TOKEN=… node scripts/release.mjs function <name>
   ```
6. **Office site.** Create a site on the web host at `siteUrl` that publishes this repository. A dev site publishes `main`. A production's site publishes `release/<name>` and no other branch; create that branch at the commit of `main` the database was built from. The site needs no settings of its own. Until the entry is on the branch it publishes, its build fails and nothing is published, which is expected.
7. **Repository environment.** Add one named `<name>` with that database's `DATABASE_URL` and, for a production, its `SUPABASE_SERVICE_ROLE_KEY` (see "Secrets").
8. **Merge the pull request.** A dev site now builds, and every merge is released to it. A production gets its first site from the "Release to production" workflow.
9. **First administrator.** A new database has no users, and everyone else is invited from Users & Access by an administrator. This command creates the first one and emails their invitation. It works only while the database has no active administrator; run it again to resend, or with another email to withdraw the first invitation and send a new one.
   ```bash
   SUPABASE_SERVICE_ROLE_KEY=… node scripts/create-first-admin.mjs <name> lead@example.com "Full Name"
   ```
10. **Dev only: sample data.** Three projects with yard records, inventory, outside shops, shop contacts, shipments and a schedule, written in the administrator's name (the one who has finished setup, or whose invitation is outstanding; never a withdrawn one). Only that person is added to the sample projects. It only adds rows: each part loads when its tables are empty and is skipped when they hold anything, so it never deletes or overwrites work done in dev. For a clean baseline, start a new dev database.
   ```bash
   DATABASE_URL='postgres://…' scripts/database.sh sample-data <name>
   ```
11. **Phone app.** Set the three `EXPO_PUBLIC_…` variables for the build profile that serves this environment, then run the app repository's `npm run release:check` for that profile.

## Bringing demo onto this (one time)

Demo was the only environment before this page existed. Done on November 15, 2026: the demo site builds from `environments.json`; migrations `028` and `029` are applied and its schema matches a fresh build; `SITE_URL` is stored on its admin function; the phone app's build profiles have `EXPO_PUBLIC_OFFICE_SITE_URL`; and the sign-in email templates needed no change.

What is left puts demo under the release routine. Until step 3, every merge to `main` still reaches demo at once.

1. **History.** Demo's migrations were recorded by other tools: 001 to 011 in pieces, and 019 to 025 without their `BEGIN;` and `COMMIT;` lines. Its schema matches a fresh build, so only the record differs. This stores each file's text as the record and keeps the earlier records in `supabase_migrations.schema_migrations_as_first_recorded`:
   ```bash
   DATABASE_URL='postgres://…' scripts/database.sh align-history demo
   ```
2. **Secrets.** Add the repository environments `dev` and `demo` with their `DATABASE_URL`, and the repository's `RELEASE_DEPLOY_KEY` (see "Secrets").
3. **Site.** Create `release/demo` at the commit demo serves, and set the demo site's production branch to `release/demo` on the web host.
4. **First release.** Run "Release to production" for `demo`. It deploys the admin function version that reads `SITE_URL` and reports which version it is.

## Rules

- **No customer-specific code.** A difference between customers is a setting stored in that customer's database, never a branch or a copy of the code.
- **Schema changes are migrations.** Nothing is changed by hand in any environment; `scripts/database.sh check` shows it if someone does.
- **Dev first.** A change runs on dev before it reaches any production. The release routine refuses otherwise.
- **A migration is named `<number>_<lowercase_name>.sql`**, with a later number than the one before it, and is one transaction: `BEGIN;` as its first statement and `COMMIT;` as its last line. `tests/release.test.js` fails otherwise.
- **A released migration is never edited.** The history check compares its text and stops the next release. Correct it with a new migration.
- **A change to the admin function comes with its stamp**: run `node scripts/release.mjs stamp` and commit the result.
- **A table a page listens to for live changes** must be added to the publication by a migration (see `028_live_updates.sql`); `tests/live-updates.test.js` fails otherwise.

## Not automated yet

- Applying sign-in settings from a script (step 4 is by hand).
- Running the phone app's settings check as part of publishing.
- The tracker sync, which still runs from a legacy repository with no per-environment setup (`docs/INTEGRATION_OWNERSHIP.md`).
