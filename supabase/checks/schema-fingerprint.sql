-- Schema fingerprint: one row per object in the shared database (kind, key,
-- md5 of its normalized definition). A plain read-only SELECT, so it runs
-- against production as well as a fresh build; compare the two outputs.
-- Column hashes include each column's position, because views built with
-- SELECT * depend on it. Supabase's own storage triggers are excluded since
-- the platform manages them. Used by scripts/schema-fingerprint.sh.
with items as (
  select 'table' as kind, c.relname::text as key,
         md5(c.relkind::text || c.relrowsecurity::text || c.relforcerowsecurity::text) as h
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
  union all
  select 'column', c.relname || '.' || a.attname,
         md5(format_type(a.atttypid, a.atttypmod) || a.attnotnull::text
             || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || a.attidentity::text || a.attgenerated::text
             || (row_number() over (partition by a.attrelid order by a.attnum))::text)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint', c.conrelid::regclass::text || '.' || c.conname, md5(pg_get_constraintdef(c.oid))
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'public'
  union all
  select 'index', i.tablename || '.' || i.indexname, md5(i.indexdef)
    from pg_indexes i where i.schemaname = 'public'
  union all
  select 'policy', p.schemaname || '.' || p.tablename || '.' || p.policyname,
         md5(p.cmd || p.permissive || array_to_string(p.roles, ',') || coalesce(p.qual, '') || coalesce(p.with_check, ''))
    from pg_policies p where p.schemaname in ('public', 'storage')
  union all
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(p.prosrc || p.prosecdef::text || p.provolatile::text || coalesce(array_to_string(p.proconfig, ','), '')
             || pg_get_function_result(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'trigger', t.tgrelid::regclass::text || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage')
  union all
  select 'view', c.relname, md5(pg_get_viewdef(c.oid))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
  union all
  select 'type', t.typname,
         md5(coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), ''))
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typtype in ('e', 'd')
     and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
  union all
  select 'sequence', c.relname, md5('')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
  union all
  select 'bucket', b.id, md5(coalesce(b.public::text, '')) from storage.buckets b
)
select kind, key, h from items where not (kind = 'trigger' and key like 'storage.%')
