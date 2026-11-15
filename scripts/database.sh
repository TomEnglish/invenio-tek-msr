#!/usr/bin/env bash
# Set up the database of a new environment (see environments.json).
#
#   DATABASE_URL=postgres://... scripts/database.sh build <environment>
#       Builds a NEW, empty database from supabase/migrations, in filename
#       order, records each migration in the history table and confirms the
#       result matches a fresh build line for line. Refuses a database that
#       already holds the schema.
#
#   DATABASE_URL=postgres://... scripts/database.sh sample-data <environment>
#       Loads supabase/seed/dev_seed.sql in one transaction. Dev environments
#       only. It fills what is empty and never deletes or replaces a row.
#
#   DATABASE_URL=postgres://... scripts/database.sh check <environment>
#       Read-only: compares the database with a fresh build of the migrations.
#
# Every command first confirms DATABASE_URL is that environment's own database,
# so a command meant for dev cannot run against a production. DATABASE_URL is
# the direct connection string from the database's settings; it is never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
fail() { echo "$1" >&2; exit 1; }

command=${1:-}; environment=${2:-}
[ -n "$command" ] && [ -n "$environment" ] || usage
[ -n "${DATABASE_URL:-}" ] || fail "Set DATABASE_URL to the $environment database's connection string."
export LC_ALL=${LC_ALL:-C}
# Only the address in DATABASE_URL may decide where these commands go. The
# database client would otherwise let these settings redirect or complete it.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGSERVICE PGSERVICEFILE

# Prints the environment's kind, or stops when the address is another environment's.
kind=$(node scripts/environments.mjs database "$environment")

run_sql() { psql -X -q -v ON_ERROR_STOP=1 -d "$DATABASE_URL" "$@"; }
ask() { run_sql -A -t -c "$1"; }

compare_with_fresh_build() {
  local work fresh live
  work=$(mktemp -d "${TMPDIR:-/tmp}/database-check.XXXXXX")
  fresh="$work/fresh"; live="$work/live"
  env -u DATABASE_URL scripts/schema-fingerprint.sh > "$fresh"
  scripts/schema-fingerprint.sh > "$live"
  if diff "$fresh" "$live" > "$work/diff"; then
    rm -rf "$work"
    echo "The $environment database matches a fresh build of the migrations on every line."
  else
    echo "The $environment database differs from a fresh build (< fresh build, > $environment):" >&2
    cat "$work/diff" >&2
    rm -rf "$work"
    return 1
  fi
}

case "$command" in
  build)
    [ "$(ask "select to_regclass('public.projects') is null and to_regclass('public.users') is null")" = t ] \
      || fail "The $environment database already holds the schema. 'build' is only for a new, empty database; nothing was changed."
    run_sql -c "create schema if not exists supabase_migrations" \
            -c "create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text)"
    [ "$(ask "select count(*) from supabase_migrations.schema_migrations")" = 0 ] \
      || fail "The $environment database has migration history but no schema. Reset it before building; nothing was changed."
    count=0
    for file in supabase/migrations/*.sql; do
      base=$(basename "$file" .sql)
      echo "Applying $base"
      # Migrations carry their own transactions, so a failure leaves the earlier ones in place.
      run_sql -f "$file" > /dev/null || fail "Stopped at $base. The $environment database is partly built: delete it, create it again, then run build again."
      # Recorded the way the platform records its own, so its tools see the same history as the files.
      run_sql -v version="${base%%_*}" -v name="${base#*_}" -v file="$file" > /dev/null <<'SQL'
\set body `cat :'file'`
insert into supabase_migrations.schema_migrations (version, name, statements) values (:'version', :'name', array[:'body']);
SQL
      count=$((count + 1))
    done
    echo "Applied $count migrations."
    compare_with_fresh_build
    ;;
  sample-data)
    [ "$kind" = dev ] || fail "$environment is a $kind environment. Sample data is for dev environments only; nothing was changed."
    [ "$(ask "select to_regclass('public.projects') is not null")" = t ] || fail "Build the $environment database first (scripts/database.sh build $environment)."
    run_sql --single-transaction -f supabase/seed/dev_seed.sql
    ask "select 'The $environment database now holds '||(select count(*) from public.projects)||' projects, '||(select count(*) from public.materials)||' materials, '||(select count(*) from public.receiving_records)||' receipts, '||(select count(*) from public.inventory_records)||' inventory rows, '||(select count(*) from public.shipments)||' shipments, '||(select count(*) from public.project_schedule)||' schedule activities.'"
    ;;
  check)
    compare_with_fresh_build
    ;;
  *) usage ;;
esac
