-- 027: receiving photos are capped like count and license photos, and found by receipt through an index. The test
-- database's buckets table has no limit columns, so they are added here and
-- the migration is applied again, as it applies where they exist.
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS file_size_limit bigint, ADD COLUMN IF NOT EXISTS allowed_mime_types text[];
\i supabase/migrations/027_receiving_photo_limits.sql

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='inspection-photos'
   AND file_size_limit=10485760 AND allowed_mime_types=ARRAY['image/jpeg','image/png']) THEN
  RAISE EXCEPTION 'inspection-photos should take JPEG or PNG photos up to 10 MB';
 END IF;
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='inspection-photos' AND public IS DISTINCT FROM false) THEN
  RAISE EXCEPTION 'inspection-photos must stay private';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='inspection_photos'
   AND indexname='inspection_photos_receipt' AND indexdef LIKE '%(receiving_record_id)%') THEN
  RAISE EXCEPTION 'a receipt''s photos should be found through an index';
 END IF;
 -- The other storage areas keep their own limits.
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id<>'inspection-photos' AND file_size_limit IS NOT NULL) THEN
  RAISE EXCEPTION '027 must change only the receiving photo area';
 END IF;
END $$;
