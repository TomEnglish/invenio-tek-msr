-- One-time repair of production's migration history after the legacy Field
-- migrations moved into this repository and were renumbered (see
-- supabase/README.md). It changes only supabase_migrations.schema_migrations,
-- never the schema itself, so the Supabase CLI and branching see the same
-- history as the files.
--
--   before                                   after
--   010  fix_rls_and_add_msr_project_id  ->  011  fix_rls_and_add_msr_project_id
--   011  msr_table_definitions           ->  009  msr_table_definitions
--   20260306230739  009_secure_users_rls ->  010  secure_users_rls
--
-- Each row keeps the SQL it was recorded with. Run once, after the pull request
-- that renumbers the files is merged, and only with the owner's approval. The
-- guard stops without changing anything if the history is not in the expected
-- starting state, so a second run is harmless.

begin;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
       where (version, name) in (('010', 'fix_rls_and_add_msr_project_id'),
                                 ('011', 'msr_table_definitions'),
                                 ('20260306230739', '009_secure_users_rls'))) <> 3
     or exists (select 1 from supabase_migrations.schema_migrations where version = '009') then
    raise exception 'Migration history is not in the expected pre-repair state; nothing was changed.';
  end if;
end $$;

create temp table old_history on commit drop as
  select version, statements from supabase_migrations.schema_migrations
   where version in ('010', '011', '20260306230739');

insert into supabase_migrations.schema_migrations (version, name, statements)
  select '009', 'msr_table_definitions', statements from old_history where version = '011';

update supabase_migrations.schema_migrations m
   set name = 'secure_users_rls', statements = o.statements
  from old_history o
 where m.version = '010' and o.version = '20260306230739';

update supabase_migrations.schema_migrations m
   set name = 'fix_rls_and_add_msr_project_id', statements = o.statements
  from old_history o
 where m.version = '011' and o.version = '010';

delete from supabase_migrations.schema_migrations where version = '20260306230739';

do $$
begin
  if (select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations)
     <> '001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016,017,018' then
    raise exception 'Unexpected migration history after repair; rolled back.';
  end if;
end $$;

commit;
