-- Sample data for a DEV database: three projects with yard records, inventory,
-- outside shops, shop contacts, shipments and a 118-activity schedule.
--
-- Load it with:  DATABASE_URL=... scripts/database.sh sample-data <dev environment>
-- which refuses any environment that is not a dev one, checks the address is
-- that environment's database, and wraps everything in one transaction.
--
-- It only ever ADDS rows. Each of the three parts below loads when its tables
-- are empty and is skipped, untouched, when they hold anything. So it never
-- deletes or overwrites work done in dev, and running it again is harmless.
-- To get back to a clean baseline, start a new dev database (build, first
-- administrator, sample data).
--
-- It needs an administrator who is active or invited (scripts/create-first-admin.mjs),
-- because the sample records are written in that person's name. A withdrawn
-- invitation does not count.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE role='admin' AND is_active AND invitation_status<>'cancelled') THEN
  RAISE EXCEPTION 'Create the first administrator before loading sample data (scripts/create-first-admin.mjs)';
 END IF;
END $$;

-- 1. Yard records: locations, tags, receipts, materials and an issue, in Main Yard, North Site and South Site.
SELECT NOT EXISTS(SELECT 1 FROM public.locations) AND NOT EXISTS(SELECT 1 FROM public.qr_codes)
   AND NOT EXISTS(SELECT 1 FROM public.receiving_records) AND NOT EXISTS(SELECT 1 FROM public.materials) AS load_yard \gset
\if :load_yard
\ir field_seed_multi_project.sql
\echo 'Yard records: loaded.'
\else
\echo 'Yard records: already there, left as they are.'
\endif

-- 2. Inventory, outside shop inventory, shop contacts and shipments.
SELECT NOT EXISTS(SELECT 1 FROM public.inventory_records) AND NOT EXISTS(SELECT 1 FROM public.outside_shop_inventory)
   AND NOT EXISTS(SELECT 1 FROM public.shop_contacts) AND NOT EXISTS(SELECT 1 FROM public.shipments) AS load_inventory \gset
\if :load_inventory
\ir seed_inventory_data.sql
\echo 'Inventory, outside shops and shipments: loaded.'
\else
\echo 'Inventory, outside shops and shipments: already there, left as they are.'
\endif

-- 3. The project schedule.
SELECT NOT EXISTS(SELECT 1 FROM public.project_schedule) AS load_schedule \gset
\if :load_schedule
\ir seed_project_schedule.sql
\echo 'Schedule: loaded.'
\else
\echo 'Schedule: already there, left as it is.'
\endif
