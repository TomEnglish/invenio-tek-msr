drop policy "Users can read own profile" on public.users;
drop policy "Admins can read all users" on public.users;
drop policy "Office staff can read all users" on public.users;

create policy "Authenticated users can read users" on public.users for select using (auth.uid() is not null);

