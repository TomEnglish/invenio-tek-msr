# Shared database

This folder is the only home for the database that the MSR site and the Invenio Field app share (Supabase project `lzroduricxyshgyjdkki`, "InventoryApp_w_MSR"). The Field repository no longer carries migrations.

| Folder | What it holds |
| --- | --- |
| `migrations/` | Every schema change, 001 onward |
| `functions/` | Edge functions (`admin-users`) |
| `checks/` | `schema-fingerprint.sql`, used to compare databases |
| `seed/` | Sample data for test and development databases |
| `repair/` | One-time fixes to migration history, run only with the owner's approval |
| `archive/` | Superseded hand-run SQL. Never run these. |

## Rules

- **Every schema change is a new file in `migrations/`.** Don't change production from the SQL editor. Anything done by hand there is missing from every other environment.
- **Migrations apply in filename order.** That's the order Supabase uses for new environments and branches, and the order `tests/database/run.sh` uses. A migration may only depend on files that sort before it.
- **New migrations use a timestamp prefix** (`supabase migration new <name>` creates one). Timestamps sort after the numbered 001–018 files.
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

## Seeds

`seed/` collects the sample-data scripts from both repositories. They have **not** been checked against the current schema yet. Setting up the test environment turns them into a working `seed.sql`.
