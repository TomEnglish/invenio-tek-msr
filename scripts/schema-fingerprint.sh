#!/usr/bin/env bash
# Print a fingerprint of the shared database schema.
#
#   scripts/schema-fingerprint.sh            fresh build from supabase/migrations
#   scripts/schema-fingerprint.sh --detail   one line per object instead of per kind
#   DATABASE_URL=... scripts/schema-fingerprint.sh
#                                            a live database, in a read-only session
#
# Two databases have the same schema when their summaries match line for line.
set -euo pipefail
cd "$(dirname "$0")/.."

detail=0
[ "${1:-}" = "--detail" ] && detail=1

query=$(sed -e 's/;[[:space:]]*$//' supabase/checks/schema-fingerprint.sql)
if [ "$detail" = 1 ]; then
  sql="select kind, key, h from (${query}) fp order by kind, key;"
else
  sql="select kind, count(*), md5(string_agg(key || ':' || h, ',' order by key)) from (${query}) fp group by kind order by kind;"
fi
run_query() { psql -X -q -A -t -F '|' -v ON_ERROR_STOP=1 "$@" -c "$sql"; }

if [ -n "${DATABASE_URL:-}" ]; then
  PGOPTIONS='-c default_transaction_read_only=on' run_query "$DATABASE_URL"
  exit 0
fi

# Postgres on macOS refuses to start without a locale.
export LC_ALL=${LC_ALL:-C}
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/schema-fingerprint.XXXXXX")
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
cleanup() {
  pg_ctl -D "$work_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT
initdb -D "$work_dir/data" -A trust --no-locale >/dev/null
# TCP only: a Unix socket path under a long TMPDIR can exceed the 103-byte limit.
pg_ctl -D "$work_dir/data" -l "$work_dir/server.log" -o "-h 127.0.0.1 -k '' -p $port" -w start >/dev/null
export PGHOST=127.0.0.1 PGPORT="$port" PGDATABASE=postgres
apply_sql() { psql -X -q -v ON_ERROR_STOP=1 -f "$1" >"$work_dir/last.log" 2>&1 || { echo "Failed applying $1" >&2; cat "$work_dir/last.log" >&2; exit 1; }; }
apply_sql tests/database/bootstrap.sql
for migration in supabase/migrations/*.sql; do apply_sql "$migration"; done
run_query
