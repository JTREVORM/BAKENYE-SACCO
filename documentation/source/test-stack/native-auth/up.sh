#!/usr/bin/env bash
# Bring up a FULLY ISOLATED stack with real Supabase Auth.
#
#   bash documentation/source/test-stack/native-auth/up.sh
#
# It builds nothing you have not asked for, touches no hosted project, and
# throws its database away each time it runs:
#
#   PostgreSQL        a database this script drops and recreates
#   GoTrue            the real supabase/auth binary, built from source
#   PostgREST         the real PostgREST, sharing GoTrue's JWT secret
#   supabase-router   one Supabase-shaped origin in front of both
#
# ORDER MATTERS. GoTrue owns the `auth` schema and runs its own migrations, so
# it goes first; the shared bootstrap then adds the API roles and the
# PostgREST-compatible auth.uid()/role() helpers without touching auth.users
# (its `create table if not exists` becomes a no-op against the real table);
# then the SACCO's own migrations and seed.
#
# When it finishes it prints the environment the lifecycle suite needs.
#
# ISOLATION. Every connection string is 127.0.0.1, the JWT secret is generated
# here, and no value from any hosted project is read. Nothing in this file can
# reach production or a preview.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
STACK="$HERE/.."

PGPORT="${NATIVE_PGPORT:-54322}"
DBNAME="${NATIVE_DBNAME:-budsacco_gotrue}"
ADMIN_URL="postgresql://postgres@127.0.0.1:${PGPORT}/postgres"
DB_URL="postgresql://postgres@127.0.0.1:${PGPORT}/${DBNAME}"
GOTRUE_PORT="${NATIVE_GOTRUE_PORT:-9999}"
PGRST_PORT="${NATIVE_PGRST_PORT:-3002}"
ROUTER_PORT="${NATIVE_ROUTER_PORT:-54321}"
SITE_URL="${NATIVE_SITE_URL:-http://127.0.0.1:3000}"

# Generated per run. Not a secret from anywhere, and never reused elsewhere.
SECRET="${NATIVE_JWT_SECRET:-$(head -c 32 /dev/urandom | base64 | tr -d '/+=' )-native-isolated}"
GOTRUE_BIN="${GOTRUE_BIN:-/var/tmp/auth-src/auth}"
PSQL="psql -v ON_ERROR_STOP=1 -q"

ADMIN_EMAIL="native.admin@test.invalid"
ADMIN_PASSWORD="AdminStart8x"

echo "── 0. the real GoTrue binary"
GOTRUE_BIN="$GOTRUE_BIN" bash "$HERE/build-gotrue.sh"

echo "── 1. a disposable database"
pkill -x auth 2>/dev/null || true
pkill -f "postgrest .*native" 2>/dev/null || true
pkill -f supabase-router.mjs 2>/dev/null || true
sleep 1
$PSQL "$ADMIN_URL" -c "
  select pg_terminate_backend(pid) from pg_stat_activity
   where datname = '${DBNAME}' and pid <> pg_backend_pid();" > /dev/null
$PSQL "$ADMIN_URL" -c "drop database if exists ${DBNAME};" > /dev/null
$PSQL "$ADMIN_URL" -c "create database ${DBNAME};" > /dev/null
$PSQL "$DB_URL" -c "
  create extension if not exists pgcrypto;
  create extension if not exists pg_trgm;
  create extension if not exists citext;
  create schema if not exists auth;" > /dev/null
echo "   ✔ ${DBNAME}"

echo "── 2. GoTrue's own migrations build the real auth schema"
cat > /var/tmp/native-gotrue.env <<EOF
GOTRUE_DB_DRIVER=postgres
DATABASE_URL=postgres://postgres@127.0.0.1:${PGPORT}/${DBNAME}?sslmode=disable
GOTRUE_DB_NAMESPACE=auth
API_EXTERNAL_URL=http://127.0.0.1:${ROUTER_PORT}
GOTRUE_API_HOST=127.0.0.1
PORT=${GOTRUE_PORT}
GOTRUE_JWT_SECRET=${SECRET}
GOTRUE_JWT_AUD=authenticated
# Required, despite GoTrue logging a deprecation notice for it: this is what
# puts `"role": "authenticated"` in the access token, and PostgREST reads that
# claim to decide which database role to assume. Without it every session
# arrives as `anon` and reads nothing - which the lifecycle suite's `jwt-claims`
# assertion catches rather than passing over.
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_EXP=3600
GOTRUE_SITE_URL=${SITE_URL}
GOTRUE_URI_ALLOW_LIST=${SITE_URL}/**
GOTRUE_DISABLE_SIGNUP=true
GOTRUE_MAILER_AUTOCONFIRM=true
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_EXTERNAL_PHONE_ENABLED=false
GOTRUE_PASSWORD_MIN_LENGTH=8
GOTRUE_LOG_LEVEL=warn
EOF
set -a; . /var/tmp/native-gotrue.env; set +a
(cd "$(dirname "$GOTRUE_BIN")" && "$GOTRUE_BIN" migrate) 2>&1 | tail -2
echo "   ✔ $($PSQL "$DB_URL" -t -A -c "select count(*) from pg_tables where schemaname='auth';") auth tables, created by GoTrue itself"

echo "── 3. API roles and the PostgREST-compatible auth helpers"
$PSQL "$DB_URL" -f "$STACK/00_bootstrap.sql" > /dev/null
$PSQL "$DB_URL" -f "$STACK/01_storage.sql" > /dev/null
$PSQL "$DB_URL" <<'SQL' > /dev/null
-- Real Supabase runs GoTrue as supabase_auth_admin, owning the auth schema,
-- with search_path = auth. Mirror that rather than widening postgres's path.
alter role supabase_auth_admin with login password 'auth_admin' createrole;
alter role supabase_auth_admin set search_path = auth, public, extensions;
alter schema auth owner to supabase_auth_admin;
grant all on schema auth to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='auth' loop
    execute format('alter table auth.%I owner to supabase_auth_admin', r.tablename);
  end loop;
  for r in select sequence_name from information_schema.sequences where sequence_schema='auth' loop
    execute format('alter sequence auth.%I owner to supabase_auth_admin', r.sequence_name);
  end loop;
end $$;
-- The shared bootstrap grants the API roles SELECT on auth.users; a real
-- Supabase project does not. Revoke it, so this stack is stricter.
revoke select on auth.users from anon, authenticated;
alter role authenticator with login password 'authenticator';
grant anon, authenticated, service_role to authenticator;
SQL
echo "   ✔ roles set, GoTrue re-pointed at supabase_auth_admin"
sed -i "s|DATABASE_URL=postgres://postgres@|DATABASE_URL=postgres://supabase_auth_admin:auth_admin@|" /var/tmp/native-gotrue.env

echo "── 4. the SACCO's migrations"
n=0
for f in "$REPO"/supabase/migrations/*.sql; do
  $PSQL "$DB_URL" -f "$f" > /dev/null || { echo "   ✖ FAILED: $(basename "$f")"; exit 1; }
  n=$((n+1))
done
echo "   ✔ $n migrations applied over the real auth schema"
$PSQL "$DB_URL" -c "
  grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;
  grant all on all functions in schema public to service_role;" > /dev/null

echo "── 5. GoTrue"
set -a; . /var/tmp/native-gotrue.env; set +a
(cd "$(dirname "$GOTRUE_BIN")" && setsid "$GOTRUE_BIN" serve < /dev/null > /var/tmp/native-gotrue.log 2>&1 &)
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:${GOTRUE_PORT}/health" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:${GOTRUE_PORT}/health" 2>/dev/null \
  || { echo "   ✖ GoTrue did not start"; tail -20 /var/tmp/native-gotrue.log; exit 1; }
echo "   ✔ real GoTrue on ${GOTRUE_PORT}"

echo "── 6. the API keys GoTrue will accept"
KEYS=$(SECRET="$SECRET" node -e '
const crypto = require("node:crypto");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tok = (role) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ role, iss: "supabase", iat: 1700000000, exp: 2000000000 });
  const s = crypto.createHmac("sha256", process.env.SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
};
console.log(JSON.stringify({ anon: tok("anon"), service: tok("service_role") }));
')
ANON=$(node -e "console.log(JSON.parse(process.argv[1]).anon)" "$KEYS")
SERVICE=$(node -e "console.log(JSON.parse(process.argv[1]).service)" "$KEYS")

echo "── 7. the first administrator, created through GoTrue's Admin API"
curl -fsS -X POST "http://127.0.0.1:${GOTRUE_PORT}/admin/users" \
  -H "Authorization: Bearer ${SERVICE}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\",\"email_confirm\":true,\"app_metadata\":{\"role\":\"super_admin\"},\"user_metadata\":{\"full_name\":\"Native Auth Admin\"}}" \
  > /dev/null
admins=$($PSQL "$DB_URL" -t -A -c "select count(*) from app_users where role='super_admin';")
[ "$admins" = "1" ] || { echo "   ✖ expected one super admin, found $admins"; exit 1; }
# The provisioning trigger starts every SACCO-created account on a forced
# change; the seed needs a settled administrator to run as.
$PSQL "$DB_URL" -c "update app_users set must_change_password=false, password_set_at=now() where role='super_admin';" > /dev/null
echo "   ✔ provisioned by the SACCO trigger, from GoTrue's own insert"

echo "── 8. seed"
$PSQL "$DB_URL" -f "$REPO/supabase/seed.sql" 2>&1 | grep -iE "^psql.*(ERROR|FATAL)" && { echo "   ✖ seed failed"; exit 1; }
echo "   ✔ $($PSQL "$DB_URL" -t -A -c 'select count(*) from members;') members, $($PSQL "$DB_URL" -t -A -c 'select count(*) from transactions;') transactions"

echo "── 9. PostgREST, sharing GoTrue's JWT secret"
cat > /var/tmp/native-postgrest.conf <<EOF
db-uri = "postgresql://authenticator:authenticator@127.0.0.1:${PGPORT}/${DBNAME}"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 10
jwt-secret = "${SECRET}"
jwt-role-claim-key = ".role"
server-host = "127.0.0.1"
server-port = ${PGRST_PORT}
db-extra-search-path = "public, extensions"
EOF
PGRST_BIN="${PGRST_BIN:-/var/tmp/bud-docs-stack/postgrest}"
[ -x "$PGRST_BIN" ] || { echo "   ✖ PostgREST binary not found at $PGRST_BIN"; exit 1; }
setsid "$PGRST_BIN" /var/tmp/native-postgrest.conf < /dev/null > /var/tmp/native-postgrest.log 2>&1 &
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:${PGRST_PORT}/" 2>/dev/null && break
  sleep 1
done
echo "   ✔ real PostgREST on ${PGRST_PORT}"

echo "── 10. the Supabase-shaped router"
ROUTER_PORT="$ROUTER_PORT" GOTRUE_URL="http://127.0.0.1:${GOTRUE_PORT}" \
  POSTGREST_URL="http://127.0.0.1:${PGRST_PORT}" \
  setsid node "$HERE/supabase-router.mjs" < /dev/null > /var/tmp/native-router.log 2>&1 &
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:${ROUTER_PORT}/auth/v1/health" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:${ROUTER_PORT}/auth/v1/health" 2>/dev/null \
  || { echo "   ✖ the router did not come up"; cat /var/tmp/native-router.log; exit 1; }
echo "   ✔ router on ${ROUTER_PORT}"

cat <<EOF

The stack is up.

NOTE: the JWT secret is generated afresh on every run, so the keys below are
new. If you are also driving the application against this stack, rebuild and
restart it with these values in .env.local - a server still holding the previous
run's keys gets "Invalid login credentials" from GoTrue for every sign-in, which
looks like a product failure and is not one. Export NATIVE_JWT_SECRET to pin the
secret across runs and avoid the rebuild.

To run the lifecycle certification:

export NATIVE_SUPABASE_URL=http://127.0.0.1:${ROUTER_PORT}
export NATIVE_ANON_KEY='${ANON}'
export NATIVE_SERVICE_KEY='${SERVICE}'
export NATIVE_DATABASE_URL='${DB_URL}'
export NATIVE_ADMIN_EMAIL='${ADMIN_EMAIL}'
export NATIVE_ADMIN_PASSWORD='${ADMIN_PASSWORD}'
export NATIVE_AUTH_ALLOW_WRITES=1
node scripts/native-auth-lifecycle-check.mjs

Logs: /var/tmp/native-gotrue.log  /var/tmp/native-postgrest.log  /var/tmp/native-router.log
EOF
