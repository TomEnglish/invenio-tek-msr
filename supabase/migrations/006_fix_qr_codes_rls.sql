-- Fix: Allow field workers to update qr_codes.entity_id during receiving
-- Previously only office staff and admins could update qr_codes

DROP POLICY IF EXISTS "Office staff and admins can update qr_codes" ON public.qr_codes;

CREATE POLICY "Authenticated users can update qr_codes"
  ON public.qr_codes FOR UPDATE
  USING (auth.uid() IS NOT NULL);
