const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/migrations/012_admin_user_management.sql', 'utf8');

assert.match(sql, /alter table public\.users\s+add column if not exists is_active boolean not null default true/i);
assert.match(sql, /create table if not exists public\.user_admin_audit/i);
assert.match(sql, /create or replace function public\.is_active_user/i);
assert.match(sql, /create or replace function public\.is_admin/i);
assert.match(sql, /create or replace function public\.handle_new_user/i);
assert.match(sql, /['"]field_worker['"]/i);
assert.doesNotMatch(sql, /raw_user_meta_data\s*->>\s*['"]role['"]/i);
assert.match(sql, /prevent_last_admin_removal/i);
assert.match(sql, /create policy [^;]+admins can read user audit/i);
assert.match(sql, /alter table public\.user_projects enable row level security/i);
assert.match(sql, /public\.is_active_user\s*\(\s*\(select auth\.uid\(\)\)\s*\)/i);
assert.match(sql, /'purchase_orders'/i);
assert.match(sql, /Project members can read '\s*\|\|\s*table_name/i);
assert.match(sql, /Project members can update '\s*\|\|\s*table_name/i);

console.log('auth migration tests passed');
