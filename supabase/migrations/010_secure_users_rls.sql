-- ============================================
-- 009: SECURE USERS RLS
-- Fixes cross-tenant data leak by restricting profile visibility
-- and adding explicit mutation controls
-- ============================================

-- 1. Drop the overly permissive SELECT policy
drop policy if exists "Authenticated users can read users" on public.users;

-- 2. Create strict SELECT policy
-- A user can see a profile IF:
--   a) It is their own profile
--   b) They are an admin
--   c) They share at least one project via user_projects
create policy "Users can read profiles based on shared projects"
  on public.users for select
  using (
    id = auth.uid() 
    or
    (
      -- User is admin
      exists (
        select 1 from public.users admin_check
        where admin_check.id = auth.uid() and admin_check.role = 'admin'
      )
    )
    or
    (
      -- User shares a project
      exists (
        select 1 from public.user_projects my_projects
        join public.user_projects their_projects on my_projects.project_id = their_projects.project_id
        where my_projects.user_id = auth.uid() 
        and their_projects.user_id = public.users.id
      )
    )
  );

-- 3. Create explicit UPDATE policy
-- Users can always update their own name, but NEVER their own role
-- Admins can update any profile (including roles)
create policy "Users can update their own name, admins can update anything"
  on public.users for update
  using (
    id = auth.uid() 
    or 
    exists (
      select 1 from public.users admin_check
      where admin_check.id = auth.uid() and admin_check.role = 'admin'
    )
  )
  with check (
    (
      id = auth.uid() 
      and 
      -- If updating themselves, they cannot alter their role
      -- (Check ensures the old role is identical to the new role being submitted)
      (
        select role from public.users where id = auth.uid()
      ) = role
    )
    or 
    exists (
      select 1 from public.users admin_check
      where admin_check.id = auth.uid() and admin_check.role = 'admin'
    )
  );
