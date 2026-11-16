# Shared database

This folder is the only home for the database schema that the MSR site and the Invenio Field app share. The Field repository no longer carries migrations.

Every environment (dev, demo, each customer) has its own database built from these same migrations; see [`docs/ENVIRONMENTS.md`](../docs/ENVIRONMENTS.md). The demo production is Supabase project `lzroduricxyshgyjdkki`, "InventoryApp_w_MSR".

| Folder | What it holds |
| --- | --- |
| `migrations/` | Every schema change, 001 onward |
| `functions/` | Edge functions (`admin-users`) |
| `checks/` | `schema-fingerprint.sql`, used to compare databases |
| `seed/` | Sample data for dev databases (`dev_seed.sql`), never for a production |
| `templates/` | Invitation and reset emails, with a placeholder for each environment's site address |
| `repair/` | One-time fixes to migration history, run only with the owner's approval |
| `archive/` | Superseded hand-run SQL. Never run these. |

## Rules

- **Every schema change is a new file in `migrations/`.** Don't change production from the SQL editor. Anything done by hand there is missing from every other environment.
- **Migrations apply in filename order.** That's the order Supabase uses for new environments and branches, and the order `tests/database/run.sh` uses. A migration may only depend on files that sort before it.
- **A new migration takes the next number** (`030_…` after `029_…`), named `<number>_<lowercase_name>.sql`. `scripts/migrations.mjs` refuses a name or number that would apply out of order.
- **Never edit a migration that has run in production**, except to bring a definition back in line with what production actually has (as was done for 009).

## History: the 2026-10-27 renumbering

Migrations 001–011 used to live in the Field repository, and applying them in filename order failed. Old 010 needs tables that only old 011 creates, and the timestamp-named 009 had to run between them. The test harness hid this with a hand-written order. The files were moved here and renumbered so that filename order is the order that works:

| Before (Field repository) | Now |
| --- | --- |
| `001`–`008` | unchanged |
| `011_msr_table_definitions` | `009_msr_table_definitions` |
| `20260306230739_009_secure_users_rls` | `010_secure_users_rls` |
| `010_fix_rls_and_add_msr_project_id` | `011_fix_rls_and_add_msr_project_id` |
| `012`–`018` | unchanged (already here) |

`009_msr_table_definitions` was also brought in line with production:

- Its tables list columns in production's order, with `project_id` last where production added it later. Views built with `SELECT *` depend on that order.
- It now includes two functions that had been created by hand in production: `refresh_dashboard_metrics()` and `search_material_links(text)`.

Production's own migration history still uses the old numbers until `repair/2026-10-27-renumber-legacy-migrations.sql` is run. That script changes only the history table, never the schema.

## Checking a database matches the migrations

```bash
scripts/schema-fingerprint.sh                         # fresh build from these migrations
DATABASE_URL='postgres://…' scripts/schema-fingerprint.sh   # a live database, read-only
```

Each prints one line per kind of object (tables, columns, constraints, indexes, policies, functions, triggers, views, sequences, storage buckets) with a count and a hash. Two databases match when every line is identical. `--detail` prints one line per object for tracking down a difference.

On 2026-10-27 a fresh build matched production on every line: 27 tables, 560 columns (including their order), 94 constraints, 85 indexes, 62 policies, 27 functions, 12 triggers, 20 views, 12 sequences and 1 bucket. Supabase's own storage triggers are left out.

The script and `tests/database/run.sh` need PostgreSQL binaries on `PATH`. On macOS, run the test harness with `LC_ALL=C` and a short `TMPDIR`, because Postgres won't start without a locale and its socket path has a 103-byte limit. The fingerprint script handles both itself.

## An environment's database

```bash
DATABASE_URL='postgres://…' scripts/database.sh build <environment>        # new, empty database only
DATABASE_URL='postgres://…' scripts/database.sh migrate <environment>      # apply the migrations it does not have yet
DATABASE_URL='postgres://…' scripts/database.sh check <environment>        # read-only: history is the files, schema matches a fresh build
DATABASE_URL='postgres://…' scripts/database.sh sample-data <environment>  # dev environments only
```

Each command first confirms the connection string is that environment's own database (`environments.json`). `build` applies every migration in filename order, records it in `supabase_migrations.schema_migrations` the way the platform does, and stops unless the result matches a fresh build. A fresh build is 44 tables, 4 private buckets, the starter project "Main Yard", 13 tables reporting live changes (028), and no users.

`migrate` is how a release reaches a database (`docs/ENVIRONMENTS.md`, "Releasing"). It refuses unless the history recorded so far is exactly the first migration files: same numbers, names and text. Then it applies the rest, each in one transaction with its history record. So a migration must be one transaction (`BEGIN;` first, `COMMIT;` last), and one that has been released is never edited.

`align-history` is a one-time repair for a database whose history was recorded by other tools. It only works when the schema already matches a fresh build and the history lists the same migrations as the files. It stores each file's text as the record and keeps the earlier records in `supabase_migrations.schema_migrations_as_first_recorded`.

The first person in a new database is created by `scripts/create-first-admin.mjs` (029). It refuses once the database has an active administrator.

## Seeds

`seed/dev_seed.sql` is the sample data for a dev database: three projects with yard records, inventory, outside shops, shop contacts, shipments and a 118-activity schedule, written in the administrator's name (never a withdrawn invitee's).

It only adds rows. Each of its three parts loads when its tables are empty and is skipped when they hold anything, so loading it again never deletes or overwrites work done in dev. For a clean baseline, start a new dev database. The files it includes only insert, and have no transaction of their own.

Load it only through `scripts/database.sh sample-data`, which refuses a production environment and wraps the load in one transaction. `tests/database/environment-build-test.sh` loads it into a fresh build on every test run, so it stays in step with the schema.
