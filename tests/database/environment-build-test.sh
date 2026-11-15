#!/usr/bin/env bash
# scripts/database.sh against the disposable server from run.sh: a new
# environment's database is built from the migrations, matches a fresh build,
# and sample data loads only into a dev environment's own database.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGHOST:?run from tests/database/run.sh}" "${PGPORT:?}"
work=$(mktemp -d "${TMPDIR:-/tmp}/env-build.XXXXXX")
trap 'rm -rf "$work"' EXIT
fail() { echo "Environment build failed: $1" >&2; exit 1; }
passed() { printf 'Environment build passed: %s\n' "$1"; }

# A list with one local dev environment and one hosted production.
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

# What the platform provides in a new database: its roles (already in this
# server) and the auth and storage schemas.
new_database() {
  createdb "$1"
  grep -v '^CREATE ROLE' tests/database/bootstrap.sql | psql -X -q -v ON_ERROR_STOP=1 -d "$1" > /dev/null
}
url() { echo "postgresql://$PGHOST:$PGPORT/$1"; }
count() { psql -X -q -A -t -d "$1" -c "$2"; }
refused() { # refused <label> <expected message> <command...>
  local label=$1 expected=$2; shift 2
  if "$@" > "$work/out" 2>&1; then fail "$label: expected a refusal"; fi
  grep -q "$expected" "$work/out" || { cat "$work/out" >&2; fail "$label: wrong refusal"; }
}

new_database env_dev
DATABASE_URL=$(url env_dev) scripts/database.sh build devlocal > "$work/build.log" 2>&1 || { cat "$work/build.log" >&2; fail "build of a new database"; }
grep -q 'matches a fresh build of the migrations on every line' "$work/build.log" || fail "a new database must match a fresh build"
files=$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')
[ "$(count env_dev "select count(*) from supabase_migrations.schema_migrations")" = "$files" ] || fail "every migration is recorded once"
[ "$(count env_dev "select count(*) from supabase_migrations.schema_migrations m where m.statements[1] is null or m.name is null")" = 0 ] || fail "history rows carry the name and the SQL"
[ "$(count env_dev "select string_agg(version, ',' order by version) from (select version from supabase_migrations.schema_migrations order by version limit 3) v")" = "001,002,003" ] || fail "versions are the file numbers"
[ "$(count env_dev "select (select count(*) from public.projects)||'/'||(select count(*) from public.users)||'/'||(select count(*) from public.materials)")" = "1/0/0" ] || fail "a new database holds the starter project and nothing else"
passed "a new database is built in filename order, recorded, and matches a fresh build"

refused "second build" "already holds the schema" env DATABASE_URL="$(url env_dev)" scripts/database.sh build devlocal
passed "a database that already holds the schema is never rebuilt"

DATABASE_URL=$(url env_dev) scripts/database.sh check devlocal > /dev/null || fail "check of an unchanged database"
psql -X -q -d env_dev -c "alter table public.projects add column drifted text" > /dev/null
refused "drift" "differs from a fresh build" env DATABASE_URL="$(url env_dev)" scripts/database.sh check devlocal
psql -X -q -d env_dev -c "alter table public.projects drop column drifted" > /dev/null
passed "a change made by hand shows up as a difference"

# The address must be the environment's own database.
new_database env_other
refused "wrong database" 'DATABASE_URL is not the "acme" database' env DATABASE_URL="$(url env_other)" scripts/database.sh build acme
refused "wrong database for sample data" 'DATABASE_URL is not the "acme" database' env DATABASE_URL="$(url env_dev)" scripts/database.sh sample-data acme
refused "unknown environment" 'Unknown environment "nowhere"' env DATABASE_URL="$(url env_other)" scripts/database.sh build nowhere
[ "$(count env_other "select to_regclass('public.projects') is null")" = t ] || fail "a refused build changes nothing"
node -e '
  import("./scripts/environments.mjs").then(({ databaseBelongsTo }) => {
    const acme = { databaseUrl: "https://acmeref.supabase.co" }, local = { databaseUrl: "http://127.0.0.1:54321" };
    const cases = [
      [acme, "postgresql://postgres:pw@db.acmeref.supabase.co:5432/postgres", true],
      [acme, "postgresql://postgres.acmeref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres", true],
      [acme, "postgresql://postgres:pw@db.demoref.supabase.co:5432/postgres", false],
      [acme, "postgresql://postgres.demoref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres", false],
      [acme, "postgresql://postgres:acmeref@db.demoref.supabase.co:5432/acmeref", false],
      [acme, "postgresql://postgres.acmeref:pw@db.demoref.supabase.co:5432/postgres", false],
      [acme, "postgresql://acmeref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres", false],
      [acme, "postgresql://postgres:pw@db.acmeref.supabase.co:5432/postgres?sslmode=require", true],
      // The user name chooses the project only on the shared pooler, never on some other host.
      [acme, "postgresql://postgres.acmeref:pw@127.0.0.1:5432/postgres", false],
      [acme, "postgresql://postgres.acmeref:pw@some-other-host.example:5432/postgres", false],
      [acme, "postgresql://postgres.acmeref:pw@[::1]:5432/postgres", false],
      [acme, "postgresql://postgres.acmeref:pw@%64b.demoref.supabase.co:5432/postgres", false],
      [acme, "postgresql://a.b.acmeref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres", false],
      [acme, "postgresql://postgres.acmeref:pw@pooler.supabase.com.evil.test:6543/postgres", false],
      // The database client would follow these options or a second host somewhere else.
      [acme, "postgresql://postgres:pw@db.acmeref.supabase.co:5432/postgres?host=127.0.0.1", false],
      [acme, "postgresql://postgres:pw@db.acmeref.supabase.co:5432/postgres?hostaddr=10.0.0.9", false],
      [acme, "postgresql://postgres:pw@db.acmeref.supabase.co:5432/postgres?service=other", false],
      [acme, "postgresql://postgres:pw@db.acmeref.supabase.co,db.demoref.supabase.co/postgres", false],
      [acme, "postgresql://postgres:pw@db.acmeref.supabase.co./postgres", false],
      [acme, "postgresql://postgres:pw@db.acmeref.supabase.co.evil.test/postgres", false],
      [acme, "postgresql:///postgres?host=db.acmeref.supabase.co", false],
      [acme, "postgresql://127.0.0.1:5432/postgres", false],
      [acme, "https://db.acmeref.supabase.co", false],
      [acme, "not a connection string", false],
      [local, "postgresql://127.0.0.1:5432/postgres", true],
      [local, "postgresql://127.0.0.1:5432/postgres?host=db.acmeref.supabase.co", false],
      [local, "postgresql://postgres:pw@db.acmeref.supabase.co:5432/postgres", false],
    ];
    for (const [environment, connection, expected] of cases) {
      if (databaseBelongsTo(environment, connection) !== expected) { console.error("databaseBelongsTo wrong for", connection); process.exit(1); }
    }
  });' || fail "connection strings are matched to their environment"
# The check runs before anything else, so an address that redirects the database client changes nothing.
refused "redirected address" 'DATABASE_URL is not the "devlocal" database' env DATABASE_URL="$(url env_other)?host=example.invalid" scripts/database.sh build devlocal
PGHOSTADDR=203.0.113.9 DATABASE_URL=$(url env_dev) scripts/database.sh check devlocal > /dev/null || fail "connection settings left in the shell must not redirect a command"
passed "a command for one environment refuses another environment's database"

# Migration 028 on a database whose live updates were switched on by hand: partly, for every table, and again.
live() { count env_dev "select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'"; }
again() { psql -X -q -v ON_ERROR_STOP=1 -d env_dev -f supabase/migrations/028_live_updates.sql > /dev/null 2>&1 || fail "028 applied again ($1)"; }
again "unchanged"; [ "$(live)" = 13 ] || fail "a second run of 028 adds nothing"
psql -X -q -v ON_ERROR_STOP=1 -d env_dev -c "alter publication supabase_realtime drop table public.materials, public.shipments" > /dev/null
again "partly set up"; [ "$(live)" = 13 ] || fail "028 adds only the tables that are missing"
psql -X -q -v ON_ERROR_STOP=1 -d env_dev -c "drop publication supabase_realtime" -c "create publication supabase_realtime for all tables" > /dev/null
again "every table"
psql -X -q -v ON_ERROR_STOP=1 -d env_dev -c "drop publication supabase_realtime" > /dev/null
again "no publication"; [ "$(live)" = 13 ] || fail "028 creates the publication when there is none"
DATABASE_URL=$(url env_dev) scripts/database.sh check devlocal > /dev/null || fail "028 leaves the database matching a fresh build"
passed "live updates are set up the same on a new database and one switched on by hand"

# Sample data: dev only, after the first administrator, and it only ever adds.
refused "sample data before an administrator" "Create the first administrator" env DATABASE_URL="$(url env_dev)" scripts/database.sh sample-data devlocal
psql -X -q -v ON_ERROR_STOP=1 -d env_dev -c "insert into auth.users(id,email) values ('d0000000-0000-4000-8000-000000000002','dev-worker@example.test')" > /dev/null
refused "sample data with only a worker" "Create the first administrator" env DATABASE_URL="$(url env_dev)" scripts/database.sh sample-data devlocal
[ "$(count env_dev "select count(*) from public.projects")" = 1 ] || fail "a refused load leaves nothing behind"
# The first invitation goes to the wrong address and is withdrawn by running the command again for the right one.
psql -X -q -v ON_ERROR_STOP=1 -d env_dev > /dev/null <<'SQL'
insert into auth.users(id,email) values ('d0000000-0000-4000-8000-000000000003','wrong-address@example.test');
set role service_role;
select public.bootstrap_first_admin('d0000000-0000-4000-8000-000000000003','Wrong Address',now()+interval '1 hour');
reset role;
update public.users set invitation_status='cancelled',is_active=false where id='d0000000-0000-4000-8000-000000000003';
SQL
refused "sample data with only a withdrawn administrator" "Create the first administrator" env DATABASE_URL="$(url env_dev)" scripts/database.sh sample-data devlocal
psql -X -q -v ON_ERROR_STOP=1 -d env_dev > /dev/null <<'SQL'
update public.users set invitation_status='pending',is_active=true where id='d0000000-0000-4000-8000-000000000003';
insert into auth.users(id,email) values ('d0000000-0000-4000-8000-000000000001','dev-admin@example.test');
set role service_role;
select public.bootstrap_first_admin('d0000000-0000-4000-8000-000000000001','Dev Admin',now()+interval '1 hour');
SQL
totals="select (select count(*) from public.projects)||' '||(select count(*) from public.locations)||' '||(select count(*) from public.materials)||' '||(select count(*) from public.receiving_records)||' '||(select count(*) from public.inventory_records)||' '||(select count(*) from public.outside_shop_inventory)||' '||(select count(*) from public.shop_contacts)||' '||(select count(*) from public.shipments)||' '||(select count(*) from public.project_schedule)"
DATABASE_URL=$(url env_dev) scripts/database.sh sample-data devlocal > "$work/seed.log" 2>&1 || { cat "$work/seed.log" >&2; fail "sample data"; }
[ "$(grep -c ': loaded\.$' "$work/seed.log")" = 3 ] || { cat "$work/seed.log" >&2; fail "all three parts load into an empty dev database"; }
first=$(count env_dev "$totals")
[ "$first" = "3 5 5 5 36 23 11 17 118" ] || fail "sample data totals were: $first"
[ "$(count env_dev "select count(distinct created_by)||' '||min(created_by::text) from public.receiving_records")" = "1 d0000000-0000-4000-8000-000000000001" ] || fail "sample records are written in the first administrator's name"
[ "$(count env_dev "select (select count(*) from public.user_projects where user_id='d0000000-0000-4000-8000-000000000001')||' '||(select count(*) from public.user_projects where user_id='d0000000-0000-4000-8000-000000000002')||' '||(select count(*) from public.user_projects where user_id='d0000000-0000-4000-8000-000000000003')")" = "3 0 0" ] || fail "only the administrator is added to the sample projects, never a withdrawn invitee"
passed "sample data loads into an empty dev database in the administrator's name, not a withdrawn invitee's"

# Work done in dev afterwards: a photo on a sample item, a new item, a changed row, a removed one.
psql -X -q -v ON_ERROR_STOP=1 -d env_dev > /dev/null <<'SQL'
insert into public.inventory_photos(inventory_uid,project_id,storage_path,created_by)
 select uid,project_id,'dev/photo-1.jpg','d0000000-0000-4000-8000-000000000001' from public.inventory_records order by id limit 1;
insert into public.shop_contacts(shop_name) values ('Dev-made Shop');
update public.projects set name='Renamed in dev' where id='11111111-1111-1111-1111-111111111111';
delete from public.project_schedule where activity_id='A1000';
SQL
worked=$(count env_dev "$totals")
DATABASE_URL=$(url env_dev) scripts/database.sh sample-data devlocal > "$work/seed.log" 2>&1 || { cat "$work/seed.log" >&2; fail "sample data, second run, with dev work in place"; }
[ "$(grep -c 'already there' "$work/seed.log")" = 3 ] || { cat "$work/seed.log" >&2; fail "a second run skips every part that holds rows"; }
[ "$(count env_dev "$totals")" = "$worked" ] || fail "a second run must not add, replace or remove anything"
[ "$(count env_dev "select (select count(*) from public.inventory_photos)||' '||(select name from public.projects where id='11111111-1111-1111-1111-111111111111')||' '||(select count(*) from public.shop_contacts where shop_name='Dev-made Shop')")" = "1 Renamed in dev 1" ] || fail "work done in dev is left exactly as it was"
# A part whose tables are emptied on purpose is filled again; the others are not touched.
psql -X -q -v ON_ERROR_STOP=1 -d env_dev -c "delete from public.project_schedule" > /dev/null
DATABASE_URL=$(url env_dev) scripts/database.sh sample-data devlocal > "$work/seed.log" 2>&1 || fail "sample data, third run"
[ "$(grep -c 'Schedule: loaded' "$work/seed.log")$(grep -c 'already there' "$work/seed.log")" = 12 ] || { cat "$work/seed.log" >&2; fail "only the emptied part is loaded again"; }
[ "$(count env_dev "select count(*) from public.project_schedule")" = 118 ] || fail "the emptied schedule is filled again"
DATABASE_URL=$(url env_dev) scripts/database.sh check devlocal > /dev/null || fail "sample data must not change the schema"
passed "running it again never deletes or overwrites work done in dev"

# A production is never given sample data, even with its own database address.
cat > "$work/environments.json" <<JSON
{ "environments": { "prodlocal": { "kind": "production", "label": "Prod", "siteUrl": "http://localhost:8093", "databaseUrl": "http://127.0.0.1:54321",
  "publicKey": "$(anon_key)", "defaultProjectId": "00000000-0000-0000-0000-000000000000" } } }
JSON
before=$(count env_dev "$totals")
refused "sample data on a production" "Sample data is for dev environments only" env DATABASE_URL="$(url env_dev)" scripts/database.sh sample-data prodlocal
[ "$(count env_dev "$totals")" = "$before" ] || fail "a refused load changes nothing"
passed "sample data is refused for a production environment"
