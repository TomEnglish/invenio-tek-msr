#!/usr/bin/env bash
# Build, release and check the database of an environment (see environments.json).
#
#   DATABASE_URL=postgres://... scripts/database.sh build <environment>
#       Builds a NEW, empty database from supabase/migrations, in filename
#       order, and confirms the result matches a fresh build line for line.
#       Refuses a database that already holds the schema.
#
#   DATABASE_URL=postgres://... scripts/database.sh migrate <environment>
#       Applies the migrations this database does not have yet, in filename
#       order, then confirms the result matches a fresh build. Refuses unless
#       the history recorded so far is exactly the first migration files.
#
#   DATABASE_URL=postgres://... scripts/database.sh check <environment>
#       Read-only: the recorded history is exactly the migration files, and
#       the schema matches a fresh build of them.
#
#   DATABASE_URL=postgres://... scripts/database.sh sample-data <environment>
#       Loads supabase/seed/dev_seed.sql in one transaction. Dev environments
#       only. It fills what is empty and never deletes or replaces a row.
#
#   DATABASE_URL=postgres://... scripts/database.sh align-history <environment>
#       One time, for a database whose history was recorded by other tools.
#       When its schema matches a fresh build and its history lists the same
#       migrations as the files, stores each file's text as that migration's
#       record. Changes the history table only and keeps the earlier records.
#
# A migration is applied in one transaction together with its history record,
# so an interrupted run leaves it either fully in or not there at all.
# Every command first confirms DATABASE_URL is that environment's own database,
# so a command meant for dev cannot run against a production. DATABASE_URL is
# the connection string from the database's settings. It is never printed, and
# its password never appears on a command line.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'; exit 2; }
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

work=$(mktemp -d "${TMPDIR:-/tmp}/database.XXXXXX")
trap 'rm -rf "$work"' EXIT

# The database client gets the address on its command line and the password in
# its environment: a command line can be read by any process on the machine.
address=$(node scripts/environments.mjs connection address)
password=$(node scripts/environments.mjs connection password)
[ -z "$password" ] || export PGPASSWORD="$password"
unset password

run_sql() { psql -X -q -v ON_ERROR_STOP=1 -d "$address" "$@"; }
ask() { run_sql -A -t -c "$1"; }

# Every answer below is compared with an expected one, so no answer at all
# would read as "no": an unreachable database would be reported as empty, or
# as different from the migrations. The connection is confirmed first.
ask 'select 1' > /dev/null \
  || fail "Could not connect to the $environment database; the database client's message is above. Check the password and the address in DATABASE_URL. Nothing was read or changed."

holds_schema() {
  local answer
  answer=$(ask "select to_regclass('public.projects') is not null or to_regclass('public.users') is not null") \
    || fail "Could not read the $environment database. Nothing was changed."
  [ "$answer" = t ]
}

# One line per recorded migration: number|name|md5 of its text|parts stored.
recorded_history() {
  local present
  present=$(ask "select to_regclass('supabase_migrations.schema_migrations') is not null") \
    || { echo "Could not read the $environment database's migration history." >&2; return 1; }
  [ "$present" = t ] || { echo "The $environment database has no migration history." >&2; return 1; }
  ask "select version || '|' || coalesce(name, '') || '|' || coalesce(md5(rtrim(statements[1], E'\n')), '') || '|' || coalesce(array_length(statements, 1), 0)
         from supabase_migrations.schema_migrations order by version collate \"C\""
}

# The migration files this database does not have yet, one per line. Stops
# unless what is recorded so far is exactly the first files: same numbers,
# names and text. A migration edited after it ran, or one applied by hand,
# shows up here before anything is applied on top of it.
pending_migrations() {
  local recorded
  recorded=$(recorded_history) || return 1
  [ -n "$recorded" ] || { echo "The $environment database holds the schema but no migration history." >&2; return 1; }
  if ! printf '%s\n' "$recorded" | node scripts/migrations.mjs pending 2> "$work/problems"; then
    echo "The $environment database's migration history is not the migration files:" >&2
    sed 's/^/  /' "$work/problems" >&2
    return 1
  fi
}

history_matches_files() {
  local pending
  pending=$(pending_migrations) || return 1
  if [ -n "$pending" ]; then
    echo "The $environment database does not have these migrations yet:" >&2
    printf '%s\n' "$pending" | sed 's/^/  /' >&2
    return 1
  fi
  echo "The $environment database's migration history is exactly the $(node scripts/migrations.mjs list | wc -l | tr -d ' ') migration files."
}

schema_matches_fresh_build() {
  # A fingerprint that could not be taken must not be compared as an empty one.
  env -u DATABASE_URL scripts/schema-fingerprint.sh > "$work/fresh" \
    || { echo "Could not build a fresh copy of the migrations to compare the $environment database with." >&2; return 1; }
  scripts/schema-fingerprint.sh > "$work/live" \
    || { echo "Could not read the $environment database's schema, so it was not compared." >&2; return 1; }
  if diff "$work/fresh" "$work/live" > "$work/diff"; then
    echo "The $environment database matches a fresh build of the migrations on every line."
  else
    echo "The $environment database differs from a fresh build (< fresh build, > $environment):" >&2
    cat "$work/diff" >&2
    return 1
  fi
}

# Applies one migration file and records it, in a single transaction. A file
# wrapped in BEGIN; and COMMIT; keeps its own transaction: it runs up to its
# COMMIT;, the record is added, and then it commits. A file with no
# transaction of its own is given one. The client's variables carry names no
# migration would contain, so nothing in a migration's own text is replaced.
apply_migration() {
  local file=$1 base shape
  base=$(basename "$file" .sql)
  shape=$(node scripts/migrations.mjs shape "$file") || return 1
  if [ "$shape" = wrapped ]; then
    node scripts/migrations.mjs without-commit "$file" > "$work/part.sql" || return 1
    run_sql -v release__version="${base%%_*}" -v release__name="${base#*_}" -v release__file="$file" -v release__part="$work/part.sql" > /dev/null <<'SQL'
\i :release__part
\set release__body `cat :'release__file'`
insert into supabase_migrations.schema_migrations (version, name, statements) values (:'release__version', :'release__name', array[:'release__body']);
commit;
SQL
  else
    run_sql -v release__version="${base%%_*}" -v release__name="${base#*_}" -v release__file="$file" > /dev/null <<'SQL'
begin;
\i :release__file
\set release__body `cat :'release__file'`
insert into supabase_migrations.schema_migrations (version, name, statements) values (:'release__version', :'release__name', array[:'release__body']);
commit;
SQL
  fi
}

# Applies the files named on stdin, in order. Prints how many were applied.
apply_migrations() {
  local file count=0
  while read -r file; do
    [ -n "$file" ] || continue
    echo "Applying $(basename "$file" .sql)"
    apply_migration "$file" || { echo "Stopped at $(basename "$file" .sql); it was not applied. $1" >&2; return 1; }
    count=$((count + 1))
  done
  echo "Applied $count migrations."
}

case "$command" in
  build)
    holds_schema && fail "The $environment database already holds the schema. 'build' is only for a new, empty database; nothing was changed."
    # Every file name and transaction shape is checked before anything is applied.
    node scripts/migrations.mjs list > "$work/files" || fail "Nothing was changed."
    run_sql -c "create schema if not exists supabase_migrations" \
            -c "create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text)"
    [ "$(ask "select count(*) from supabase_migrations.schema_migrations")" = 0 ] \
      || fail "The $environment database has migration history but no schema. Reset it before building; nothing was changed."
    # Recorded the way the platform records its own, so its tools see the same history as the files.
    sed -E 's/^([0-9]+)\|([a-z0-9_]+)\|.*$/supabase\/migrations\/\1_\2.sql/' "$work/files" \
      | apply_migrations "The $environment database is partly built: delete it, create it again, then run build again." || exit 1
    history_matches_files
    schema_matches_fresh_build
    ;;
  migrate)
    holds_schema || fail "The $environment database is empty. A new database is built with 'build'; nothing was changed."
    pending=$(pending_migrations) || fail "Nothing was changed."
    if [ -z "$pending" ]; then
      echo "The $environment database already has every migration."
    else
      printf '%s\n' "$pending" | apply_migrations "The migrations before it are in place." || exit 1
    fi
    history_matches_files
    schema_matches_fresh_build
    ;;
  sample-data)
    [ "$kind" = dev ] || fail "$environment is a $kind environment. Sample data is for dev environments only; nothing was changed."
    [ "$(ask "select to_regclass('public.projects') is not null")" = t ] || fail "Build the $environment database first (scripts/database.sh build $environment)."
    run_sql --single-transaction -f supabase/seed/dev_seed.sql
    ask "select 'The $environment database now holds '||(select count(*) from public.projects)||' projects, '||(select count(*) from public.materials)||' materials, '||(select count(*) from public.receiving_records)||' receipts, '||(select count(*) from public.inventory_records)||' inventory rows, '||(select count(*) from public.shipments)||' shipments, '||(select count(*) from public.project_schedule)||' schedule activities.'"
    ;;
  check)
    result=0
    history_matches_files || result=1
    schema_matches_fresh_build || result=1
    exit "$result"
    ;;
  align-history)
    holds_schema || fail "The $environment database is empty; nothing was changed."
    recorded=$(recorded_history) || fail "Nothing was changed."
    if ! differing=$(printf '%s\n' "$recorded" | node scripts/migrations.mjs differing 2> "$work/problems"); then
      echo "The $environment database's history lists other migrations than the files. Nothing was changed:" >&2
      sed 's/^/  /' "$work/problems" >&2
      exit 1
    fi
    if [ -z "$differing" ]; then
      echo "The $environment database already records every migration as its file. Nothing was changed."
      exit 0
    fi
    # The files may only be called this database's history when they build exactly what it holds.
    schema_matches_fresh_build || fail "'align-history' is only for a database whose schema already matches a fresh build; nothing was changed."
    saved=supabase_migrations.schema_migrations_as_first_recorded
    {
      echo "begin;"
      [ "$(ask "select to_regclass('$saved') is not null")" = t ] \
        || echo "create table $saved as select m.*, now() as set_aside_at from supabase_migrations.schema_migrations m;"
      # File names hold only digits, lowercase letters and underscores (scripts/migrations.mjs).
      while read -r file; do
        base=$(basename "$file" .sql)
        printf '\\set body `cat '"'%s'"'`\n' "$file"
        printf "update supabase_migrations.schema_migrations set statements = array[:'body'] where version = '%s';\n" "${base%%_*}"
      done <<< "$differing"
      echo "commit;"
    } > "$work/align.sql"
    run_sql -f "$work/align.sql" > /dev/null
    echo "Stored the text of $(printf '%s\n' "$differing" | wc -l | tr -d ' ') migration files as their record. The earlier records are kept in $saved."
    history_matches_files
    ;;
  *) usage ;;
esac
