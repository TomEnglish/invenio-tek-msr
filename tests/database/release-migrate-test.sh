#!/usr/bin/env bash
# scripts/database.sh migrate, check and align-history against the disposable
# server from run.sh: a database from an earlier release receives exactly the
# migrations it lacks, a failed migration leaves nothing behind, and a history
# that is not the migration files stops a release before anything is applied.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGHOST:?run from tests/database/run.sh}" "${PGPORT:?}"
work=$(mktemp -d "${TMPDIR:-/tmp}/env-release.XXXXXX")
trap 'rm -rf "$work"' EXIT
fail() { echo "Database release failed: $1" >&2; exit 1; }
passed() { printf 'Database release passed: %s\n' "$1"; }

anon_key() { node -e 'console.log("x."+Buffer.from(JSON.stringify({role:"anon",ref:process.argv[1]||undefined})).toString("base64url")+".y")' "${1:-}"; }
cat > "$work/environments.json" <<JSON
{ "environments": {
  "devlocal": { "kind": "dev", "label": "Dev", "siteUrl": "http://localhost:8092", "databaseUrl": "http://127.0.0.1:54321",
                "publicKey": "$(anon_key)", "defaultProjectId": "00000000-0000-0000-0000-000000000000" },
  "acme": { "kind": "production", "label": "Acme", "siteUrl": "https://field.acme.test", "databaseUrl": "https://acmeref.supabase.co",
            "publicKey": "$(anon_key acmeref)", "defaultProjectId": "00000000-0000-0000-0000-000000000000" }
} }
JSON
export ENVIRONMENTS_FILE="$work/environments.json"

new_database() {
  createdb "$1"
  grep -v '^CREATE ROLE' tests/database/bootstrap.sql | psql -X -q -v ON_ERROR_STOP=1 -d "$1" > /dev/null
}
url() { echo "postgresql://$PGHOST:$PGPORT/$1"; }
count() { psql -X -q -A -t -d "$1" -c "$2"; }
sql() { psql -X -q -v ON_ERROR_STOP=1 -d "$1" -c "$2" > /dev/null; }
history() { count "$1" "select count(*)||' '||max(version collate \"C\") from supabase_migrations.schema_migrations"; }
refused() { # refused <label> <expected message> <command...>
  local label=$1 expected=$2; shift 2
  if "$@" > "$work/out" 2>&1; then cat "$work/out" >&2; fail "$label: expected a refusal"; fi
  grep -q "$expected" "$work/out" || { cat "$work/out" >&2; fail "$label: wrong refusal"; }
}
# The same scripts in another folder, with whatever migrations the caller leaves there.
copy_of_repository() {
  mkdir -p "$1/supabase" "$1/tests/database"
  cp -R scripts "$1/scripts"
  cp -R supabase/checks "$1/supabase/checks"
  cp -R supabase/migrations "$1/supabase/migrations"
  cp tests/database/bootstrap.sql "$1/tests/database/bootstrap.sql"
}

files=$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')
newest=$(basename "$(ls supabase/migrations/*.sql | tail -n 1)" .sql)

# An earlier release: everything but the two newest migrations.
copy_of_repository "$work/earlier"
ls "$work/earlier/supabase/migrations/"*.sql | tail -n 2 | while read -r file; do rm "$file"; done
new_database rel_dev
DATABASE_URL=$(url rel_dev) "$work/earlier/scripts/database.sh" build devlocal > "$work/build.log" 2>&1 || { cat "$work/build.log" >&2; fail "build of the earlier release"; }
[ "$(history rel_dev | cut -d' ' -f1)" = "$((files - 2))" ] || fail "the earlier release records all but the two newest migrations"

refused "check before the release" "does not have these migrations yet" env DATABASE_URL="$(url rel_dev)" scripts/database.sh check devlocal
grep -q "$newest" "$work/out" || fail "the check names the migrations that are missing"
DATABASE_URL=$(url rel_dev) scripts/database.sh migrate devlocal > "$work/migrate.log" 2>&1 || { cat "$work/migrate.log" >&2; fail "migrate"; }
grep -q '^Applied 2 migrations\.$' "$work/migrate.log" || { cat "$work/migrate.log" >&2; fail "only the two missing migrations are applied"; }
grep -q "history is exactly the $files migration files" "$work/migrate.log" || fail "the history is confirmed after a release"
grep -q 'matches a fresh build of the migrations on every line' "$work/migrate.log" || fail "the schema is confirmed after a release"
[ "$(history rel_dev)" = "$files ${newest%%_*}" ] || fail "every migration is recorded once, the newest last"
[ "$(count rel_dev "select count(*) from supabase_migrations.schema_migrations where array_length(statements,1) is distinct from 1")" = 0 ] || fail "each migration is recorded as one text"
DATABASE_URL=$(url rel_dev) scripts/database.sh migrate devlocal > "$work/migrate.log" 2>&1 || { cat "$work/migrate.log" >&2; fail "migrate, second run"; }
grep -q 'already has every migration' "$work/migrate.log" || fail "a second run applies nothing"
DATABASE_URL=$(url rel_dev) scripts/database.sh check devlocal > /dev/null || fail "check after the release"
passed "a database from an earlier release receives exactly the migrations it lacks, and then matches a fresh build"

# A migration that fails part-way leaves no table and no record, whether or not it has its own transaction.
copy_of_repository "$work/next"
half="$work/next/supabase/migrations/99999_half_made.sql"
nothing_left() {
  [ "$(count rel_dev "select to_regclass('public.half_made') is null")" = t ] || fail "$1: a failed migration must leave no table behind"
  [ "$(history rel_dev)" = "$files ${newest%%_*}" ] || fail "$1: a failed migration must not be recorded"
}
printf 'BEGIN;\ncreate table public.half_made (id int);\nselect 1/0;\nCOMMIT;\n' > "$half"
refused "failing wrapped migration" "Stopped at 99999_half_made; it was not applied" env DATABASE_URL="$(url rel_dev)" "$work/next/scripts/database.sh" migrate devlocal
nothing_left "wrapped"
printf 'create table public.half_made (id int);\nselect 1/0;\n' > "$half"
refused "failing plain migration" "Stopped at 99999_half_made; it was not applied" env DATABASE_URL="$(url rel_dev)" "$work/next/scripts/database.sh" migrate devlocal
nothing_left "plain"
# One that could commit half of itself is refused before anything runs.
printf 'BEGIN;\ncreate table public.half_made (id int);\nCOMMIT;\nBEGIN;\nselect 1/0;\nCOMMIT;\n' > "$half"
refused "migration with two transactions" "must either have no transaction statement of its own" env DATABASE_URL="$(url rel_dev)" "$work/next/scripts/database.sh" migrate devlocal
nothing_left "two transactions"
# A command of the database client could commit or run outside the transaction, so it is refused before anything runs.
printf "create table public.half_made (id int);\nselect 'commit' \\\\gexec\nselect 1/0;\n" > "$half"
refused "migration with a client command" "must be SQL only" env DATABASE_URL="$(url rel_dev)" "$work/next/scripts/database.sh" migrate devlocal
nothing_left "client command"
# Nothing in a migration's own text is replaced by the release's variables: this fails here exactly as in a fresh build.
printf "BEGIN;\ncreate table public.half_made (label text default :'name', n int default :version);\nCOMMIT;\n" > "$half"
refused "migration naming a client variable" "Stopped at 99999_half_made; it was not applied" env DATABASE_URL="$(url rel_dev)" "$work/next/scripts/database.sh" migrate devlocal
nothing_left "client variable"
# A good one is applied and recorded with the file's own text.
printf -- '-- Made by the release test.\nBEGIN;\ncreate table public.half_made (id int);\nCOMMIT;\n' > "$half"
DATABASE_URL=$(url rel_dev) "$work/next/scripts/database.sh" migrate devlocal > "$work/migrate.log" 2>&1 || { cat "$work/migrate.log" >&2; fail "migrate of a new wrapped migration"; }
[ "$(count rel_dev "select statements[1] from supabase_migrations.schema_migrations where version='99999'")" = "$(cat "$half")" ] || fail "the record is the file's text"
# The database is now ahead of this checkout, which must not be released onto.
refused "database ahead of the files" "99999_half_made, which is not among the migration files" env DATABASE_URL="$(url rel_dev)" scripts/database.sh migrate devlocal
grep -q 'Nothing was changed' "$work/out" || fail "a refused release says nothing was changed"
sql rel_dev "drop table public.half_made; delete from supabase_migrations.schema_migrations where version='99999'"
DATABASE_URL=$(url rel_dev) scripts/database.sh check devlocal > /dev/null || fail "check after the failed migrations"
passed "a failed migration leaves nothing behind, and a database ahead of the files is refused"

# A history that is not the files stops a release: text changed after it ran, or recorded in pieces by another tool.
sql rel_dev "update supabase_migrations.schema_migrations set statements = array['select 1'] where version = '005'"
sql rel_dev "update supabase_migrations.schema_migrations set statements = array['select 1','select 2'] where version = '003'"
refused "edited history" "005_audit_log was recorded with different text than the file has now" env DATABASE_URL="$(url rel_dev)" scripts/database.sh migrate devlocal
grep -q '003_materials_and_movements was recorded in 2 parts' "$work/out" || fail "a migration recorded in pieces is named"
refused "check with an edited history" "migration history is not the migration files" env DATABASE_URL="$(url rel_dev)" scripts/database.sh check devlocal
grep -q 'matches a fresh build of the migrations on every line' "$work/out" || fail "the check still reports on the schema when the history differs"

# align-history: only when the schema matches a fresh build and the same migrations are listed.
sql rel_dev "alter table public.projects add column drifted text"
refused "align with a different schema" "only for a database whose schema already matches a fresh build" env DATABASE_URL="$(url rel_dev)" scripts/database.sh align-history devlocal
sql rel_dev "alter table public.projects drop column drifted"
sql rel_dev "update supabase_migrations.schema_migrations set name = 'renamed_by_hand' where version = '007'"
refused "align with another list" "history lists other migrations than the files" env DATABASE_URL="$(url rel_dev)" scripts/database.sh align-history devlocal
sql rel_dev "update supabase_migrations.schema_migrations set name = 'atomic_quantity_updates' where version = '007'"
[ "$(count rel_dev "select statements[1] from supabase_migrations.schema_migrations where version='005'")" = "select 1" ] || fail "a refused align changes nothing"
[ "$(count rel_dev "select to_regclass('supabase_migrations.schema_migrations_as_first_recorded') is null")" = t ] || fail "a refused align sets nothing aside"
DATABASE_URL=$(url rel_dev) scripts/database.sh align-history devlocal > "$work/align.log" 2>&1 || { cat "$work/align.log" >&2; fail "align-history"; }
grep -q 'Stored the text of 2 migration files' "$work/align.log" || { cat "$work/align.log" >&2; fail "only the records that differ are rewritten"; }
[ "$(count rel_dev "select count(*)||' '||(select statements[1] from supabase_migrations.schema_migrations_as_first_recorded where version='005')||' '||(select array_length(statements,1) from supabase_migrations.schema_migrations_as_first_recorded where version='003') from supabase_migrations.schema_migrations_as_first_recorded")" = "$files select 1 2" ] || fail "the earlier records are kept as they were"
DATABASE_URL=$(url rel_dev) scripts/database.sh check devlocal > /dev/null || fail "check after align-history"
DATABASE_URL=$(url rel_dev) scripts/database.sh align-history devlocal > "$work/align.log" 2>&1 || fail "align-history, second run"
grep -q 'already records every migration as its file' "$work/align.log" || fail "a second align changes nothing"
# A later align keeps the first set of earlier records, not the ones in between.
sql rel_dev "update supabase_migrations.schema_migrations set statements = array['select 3'] where version = '005'"
DATABASE_URL=$(url rel_dev) scripts/database.sh align-history devlocal > /dev/null 2>&1 || fail "align-history, third run"
[ "$(count rel_dev "select statements[1] from supabase_migrations.schema_migrations_as_first_recorded where version='005'")" = "select 1" ] || fail "the first earlier records are never overwritten"
DATABASE_URL=$(url rel_dev) scripts/database.sh check devlocal > /dev/null || fail "check after the third align"
passed "a history that is not the files stops a release; align-history repairs the record only when the schema matches"

# align-history needs every file recorded already: a partial or empty history is not something to tidy.
createdb -T rel_dev rel_partial
sql rel_partial "update supabase_migrations.schema_migrations set statements = array['select 1'] where version = '005'"
sql rel_partial "delete from supabase_migrations.schema_migrations where version = '${newest%%_*}'"
refused "align a partial history" "records $((files - 1)) migrations and there are $files migration files" env DATABASE_URL="$(url rel_partial)" scripts/database.sh align-history devlocal
[ "$(count rel_partial "select statements[1] from supabase_migrations.schema_migrations where version='005'")" = "select 1" ] || fail "a refused align of a partial history changes nothing"
sql rel_partial "delete from supabase_migrations.schema_migrations"
refused "align an empty history" "records 0 migrations and there are $files migration files" env DATABASE_URL="$(url rel_partial)" scripts/database.sh align-history devlocal
passed "align-history refuses a history that does not already list every migration"

# Never onto an empty database, and never onto another environment's.
new_database rel_empty
refused "migrate an empty database" "is empty. A new database is built with 'build'" env DATABASE_URL="$(url rel_empty)" scripts/database.sh migrate devlocal
refused "migrate another environment's database" 'DATABASE_URL is not the "acme" database' env DATABASE_URL="$(url rel_dev)" scripts/database.sh migrate acme
refused "align another environment's database" 'DATABASE_URL is not the "acme" database' env DATABASE_URL="$(url rel_dev)" scripts/database.sh align-history acme
[ "$(count rel_empty "select to_regclass('public.projects') is null")" = t ] || fail "a refused release changes nothing"
passed "a release refuses an empty database and another environment's database"

# A database that does not answer is reported as that, never as empty, without
# history or different from the migrations.
closed_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
for command in check migrate build align-history sample-data; do
  refused "$command against a database that does not answer" "Could not connect to the devlocal database" \
    env DATABASE_URL="postgresql://127.0.0.1:$closed_port/rel_dev" PGCONNECT_TIMEOUT=5 scripts/database.sh "$command" devlocal
  if grep -Eq 'is empty|no migration history|differs from a fresh build|already holds|Build the' "$work/out"; then
    cat "$work/out" >&2; fail "$command: a database that does not answer was described as something else"
  fi
done
passed "a database that does not answer is reported as unreachable, by every command"
