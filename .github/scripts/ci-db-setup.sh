#!/usr/bin/env bash
# Empty database -> Supabase-compatible bootstrap -> every migration in order
# -> first administrator -> synthetic seed.
#
# The same sequence `documentation/source/test-stack/clean-install.sh` runs
# locally, written against the CI service container. Nothing here reaches any
# hosted project: the database is created by this script and thrown away with
# the runner.
set -euo pipefail

DB_URL="${CI_DATABASE_URL:?CI_DATABASE_URL must be set}"
ADMIN_URL="${DB_URL%/*}/postgres"
ST=documentation/source/test-stack
PSQL="psql -v ON_ERROR_STOP=1 -q"

echo "── creating a clean database"
$PSQL "$ADMIN_URL" -c "drop database if exists budsacco_ci;" > /dev/null
$PSQL "$ADMIN_URL" -c "create database budsacco_ci;" > /dev/null

echo "── Supabase-compatible bootstrap (auth schema, API roles, storage)"
$PSQL "$DB_URL" -f "$ST/00_bootstrap.sql" > /dev/null
$PSQL "$DB_URL" -f "$ST/01_storage.sql" > /dev/null

echo "── migrations"
n=0
for f in supabase/migrations/*.sql; do
  if ! $PSQL "$DB_URL" -f "$f" > /dev/null; then
    echo "   ✖ FAILED: $(basename "$f")" >&2
    exit 1
  fi
  n=$((n+1))
done
echo "   ✔ $n migrations applied"
if [ "$n" -eq 0 ]; then
  echo "   ✖ no migrations found - refusing to report this as a pass" >&2
  exit 1
fi

echo "── the grants a hosted project gives service_role"
$PSQL "$DB_URL" -c "
  grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;
  grant all on all functions in schema public to service_role;" > /dev/null

echo "── first administrator, provisioned by the auth trigger"
$PSQL "$DB_URL" -c "
do \$\$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v, 'authenticated', 'authenticated', 'ci.admin@test.invalid', '', now(),
          jsonb_build_object('role','super_admin'),
          jsonb_build_object('full_name','CI Admin'), now(), now());
  update app_users set must_change_password = false where id = v;
end \$\$;" > /dev/null

admins=$($PSQL "$DB_URL" -t -A -c "select count(*) from app_users where role='super_admin' and is_active;")
if [ "$admins" != "1" ]; then
  echo "   ✖ expected exactly one active super admin, found $admins" >&2
  exit 1
fi
echo "   ✔ super admin provisioned"

echo "── synthetic seed"
$PSQL "$DB_URL" -f supabase/seed.sql > /dev/null
members=$($PSQL "$DB_URL" -t -A -c "select count(*) from members;")
if [ "$members" -lt 1 ]; then
  echo "   ✖ the seed produced no members; the suites below would assert nothing" >&2
  exit 1
fi
echo "   ✔ seed applied ($members members)"
