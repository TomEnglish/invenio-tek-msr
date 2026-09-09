-- Read-only preflight after confirming the shared baseline through migration 012.
-- Run against the intended database before applying 013-015. Review each result.
BEGIN READ ONLY;
SELECT current_database(),version();
SELECT role,is_active,count(*) FROM public.users GROUP BY role,is_active ORDER BY role,is_active;
SELECT count(*) AS active_admins FROM public.users WHERE role='admin' AND is_active;
SELECT u.id,u.full_name,u.role FROM public.users u WHERE u.is_active AND NOT EXISTS(SELECT 1 FROM public.user_projects up WHERE up.user_id=u.id);
SELECT p.id,p.name,p.status,count(up.user_id) AS assigned_users FROM public.projects p LEFT JOIN public.user_projects up ON up.project_id=p.id GROUP BY p.id ORDER BY p.name;
-- Duplicates must be investigated before the unique photo-reference index is added.
SELECT storage_path,count(*) FROM public.inspection_photos GROUP BY storage_path HAVING count(*)>1;
-- Legacy storage paths not starting with their receipt ID need an explicit migration.
SELECT id,receiving_record_id,storage_path FROM public.inspection_photos WHERE split_part(storage_path,'/',1)<>receiving_record_id::text;
SELECT id,name,public FROM storage.buckets WHERE id='inspection-photos';
-- These unconfirmed legacy invitations will require a fresh setup link.
SELECT u.id,u.full_name,a.invited_at FROM public.users u JOIN auth.users a ON a.id=u.id WHERE a.invited_at IS NOT NULL AND a.email_confirmed_at IS NULL;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY schemaname,tablename,policyname;
ROLLBACK;
