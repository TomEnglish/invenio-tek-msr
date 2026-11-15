-- Live updates: the dashboard's "Server connected" refresh, GPS tracking and
-- material links listen for changes, and a table only reports changes once it
-- is in the supabase_realtime publication. That was switched on by hand in
-- production, so a database built from these migrations had none of it. This
-- adds the 13 tables the office site listens to (dashboard.js,
-- samsara-tracking.js, material-tracking-supabase.js). A table already in the
-- publication is left as it is, and row security still decides who receives a
-- change. Changes no table, column, rule or function.
BEGIN;

DO $$
DECLARE watched text;
BEGIN
 -- The platform creates this publication; a plain PostgreSQL build has none.
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  CREATE PUBLICATION supabase_realtime;
 END IF;
 FOREACH watched IN ARRAY ARRAY[
  'audit_log','dashboard_metrics','delivery_dates','installation_datasets','material_issues',
  'material_links','material_movements','materials','purchase_orders','receiving_records',
  'samsara_trackers','shipments','shipments_out'
 ] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=watched) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',watched);
  END IF;
 END LOOP;
END $$;

COMMIT;
