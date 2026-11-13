-- Receiving photos get the same limits as count and license photos: JPEG or
-- PNG, up to 10 MB each. The phone app uploads JPEG; the office Receiving page
-- checks type and size before it uploads. Photos already stored are unchanged.
-- The office now asks for a receipt's photos by receipt, so they get an index.
-- Changes no column, rule or function; it stands apart from 026, but apply in number order.
BEGIN;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='allowed_mime_types') THEN
  UPDATE storage.buckets SET file_size_limit=10485760,allowed_mime_types=ARRAY['image/jpeg','image/png'] WHERE id='inspection-photos';
 END IF;
END $$;

CREATE INDEX IF NOT EXISTS inspection_photos_receipt ON public.inspection_photos(receiving_record_id);

COMMIT;
