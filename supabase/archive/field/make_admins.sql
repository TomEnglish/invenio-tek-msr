-- Update specific users to be admins based on their email address.
-- IMPORTANT: Replace the dummy emails below with the actual emails of your 2 admin accounts!

UPDATE public.users
SET role = 'admin'
WHERE email IN (
  'admin1@example.com', 
  'admin2@example.com'
);

-- (Optional) If you want to check your users to see their roles before/after running this:
-- SELECT email, role FROM public.users;
