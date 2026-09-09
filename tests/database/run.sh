#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
task_db_dir=$(mktemp -d "${TMPDIR:-/tmp}/invenio-db.XXXXXX")
task_db_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
cleanup() {
  pg_ctl -D "$task_db_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$task_db_dir"
}
trap cleanup EXIT
initdb -D "$task_db_dir/data" -A trust --no-locale >/dev/null
pg_ctl -D "$task_db_dir/data" -l "$task_db_dir/server.log" -o "-h 127.0.0.1 -k $task_db_dir -p $task_db_port" -w start >/dev/null
export PGHOST=127.0.0.1 PGPORT="$task_db_port" PGDATABASE=postgres INVENIO_DISPOSABLE_DB=1
apply_sql() { psql -X -v ON_ERROR_STOP=1 -q -f "$1" >"$task_db_dir/last.log" 2>&1 || { cat "$task_db_dir/last.log"; return 1; }; }
apply_sql tests/database/bootstrap.sql
for task_migration in ../'Invenio Field'/supabase/migrations/00[1-8]_*.sql; do apply_sql "$task_migration"; done
# Historical 010 referenced MSR tables created out-of-band. Recreate those
# definitions before applying 010, matching the actual historical dependency.
apply_sql ../'Invenio Field'/supabase/migrations/011_msr_table_definitions.sql
apply_sql ../'Invenio Field'/supabase/migrations/20260306230739_009_secure_users_rls.sql
apply_sql ../'Invenio Field'/supabase/migrations/010_fix_rls_and_add_msr_project_id.sql
apply_sql supabase/migrations/012_admin_user_management.sql
for task_migration in supabase/migrations/01[3-9]_*.sql; do
  [ -f "$task_migration" ] && apply_sql "$task_migration"
done
for task_test in tests/database/*-test.sql; do
  printf 'Database test: %s\n' "$task_test"
  apply_sql "$task_test"
done
bash tests/database/concurrency-test.sh
printf 'PostgreSQL integration tests passed.\n'
