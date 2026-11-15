BEGIN;
\ir admin-fixtures.sql
-- Migration 028: exactly the tables the office site listens to report live changes.
SELECT pg_temp.assert_true((SELECT array_agg(tablename::text ORDER BY tablename) FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND schemaname='public') = ARRAY[
  'audit_log','dashboard_metrics','delivery_dates','installation_datasets','material_issues',
  'material_links','material_movements','materials','purchase_orders','receiving_records',
  'samsara_trackers','shipments','shipments_out'],
 'The 13 watched tables, and no others, report live changes');
-- A published table with no primary key refuses every update and delete, so each one must have one.
SELECT pg_temp.assert_true(NOT EXISTS(
  SELECT 1 FROM pg_publication_tables pt
   WHERE pt.pubname='supabase_realtime'
     AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=format('%I.%I',pt.schemaname,pt.tablename)::regclass AND i.indisprimary)),
 'Every table that reports live changes has a primary key');
-- environment-build-test.sh applies the migration file again, and to a database whose live updates were set up by hand.
ROLLBACK;
