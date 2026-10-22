#!/usr/bin/env bash
# A real PostgREST in front of the CI database, so the password-security check
# exercises the API boundary rather than only the functions behind it.
set -euo pipefail

DB_URL="${CI_DATABASE_URL:?CI_DATABASE_URL must be set}"
SECRET="${REST_JWT_SECRET:?REST_JWT_SECRET must be set}"
VERSION="${POSTGREST_VERSION:-v12.2.3}"

psql -v ON_ERROR_STOP=1 -q "$DB_URL" -c "
  alter role authenticator with login password 'authenticator';
  grant anon, authenticated, service_role to authenticator;" > /dev/null

curl -fsSL -o /tmp/postgrest.tar.xz \
  "https://github.com/PostgREST/postgrest/releases/download/${VERSION}/postgrest-${VERSION}-linux-static-x64.tar.xz"
mkdir -p /tmp/postgrest && tar -xJf /tmp/postgrest.tar.xz -C /tmp/postgrest

host_port="${DB_URL#*@}"; host_port="${host_port%%/*}"
cat > /tmp/postgrest.conf <<CONF
db-uri = "postgresql://authenticator:authenticator@${host_port}/budsacco_ci"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 10
jwt-secret = "${SECRET}"
jwt-role-claim-key = ".role"
server-host = "127.0.0.1"
server-port = 3001
db-extra-search-path = "public, extensions"
CONF

/tmp/postgrest/postgrest /tmp/postgrest.conf > /tmp/postgrest.log 2>&1 &

for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:3001/" 2>/dev/null; then
    echo "✔ PostgREST ${VERSION} is answering"
    exit 0
  fi
  sleep 1
done

echo "✖ PostgREST did not start" >&2
cat /tmp/postgrest.log >&2
exit 1
