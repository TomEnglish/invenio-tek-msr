-- Some existing installations never created the bucket described in 002.
-- Keep the object access policies from 013; new photo uploads need this bucket.
BEGIN;
INSERT INTO storage.buckets (id, name, public)
VALUES ('inspection-photos', 'inspection-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;
COMMIT;
