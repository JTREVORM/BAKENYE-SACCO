#!/usr/bin/env bash
# Prove the password-security check can still FAIL.
#
# F-14's finding was not that a test was missing, it was that a passing test
# proved nothing: the temporary-password suite passed 16/16 while the bypass
# stood wide open, because it never attempted the bypass. A security test that
# cannot fail when the control is broken is worse than no test, because it
# buys false confidence.
#
# So: copy the database, put the vulnerable pre-0049 function back, point the
# check at it, and require the check to FAIL. If it passes, the check has been
# declawed and this job fails instead.
set -euo pipefail

DB_URL="${CI_DATABASE_URL:?CI_DATABASE_URL must be set}"
ADMIN_URL="${DB_URL%/*}/postgres"
VULN_URL="${DB_URL%/*}/budsacco_ci_vuln"
PSQL="psql -v ON_ERROR_STOP=1 -q"

echo "── a throwaway copy with the defect put back"
$PSQL "$ADMIN_URL" -c "drop database if exists budsacco_ci_vuln;" > /dev/null
$PSQL "$ADMIN_URL" -c "create database budsacco_ci_vuln template budsacco_ci;" > /dev/null

# Exactly the definition and grant migration 0034 left behind.
$PSQL "$VULN_URL" <<'SQL' > /dev/null
create or replace function log_password_changed()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update app_users set password_set_at = now(), must_change_password = false where id = auth.uid();
  perform write_account_audit(auth.uid(), 'auth.password_changed', 'Changed their password');
end;
$$;
grant execute on function log_password_changed() to authenticated;
SQL

# Re-point PostgREST at the vulnerable copy.
sed -i 's|/budsacco_ci"|/budsacco_ci_vuln"|' /tmp/postgrest.conf
pkill -x postgrest || true
sleep 2
/tmp/postgrest/postgrest /tmp/postgrest.conf > /tmp/postgrest-vuln.log 2>&1 &
for i in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:3001/" && break
  sleep 1
done

echo "── the check must now FAIL"
set +e
REST_DATABASE_URL="$VULN_URL" node scripts/password-security-rest-check.mjs
status=$?
set -e

$PSQL "$ADMIN_URL" -c "drop database if exists budsacco_ci_vuln;" > /dev/null || true

if [ "$status" -eq 0 ]; then
  echo "✖ the password-security check PASSED against a database with the F-01 defect restored." >&2
  echo "  The check can no longer detect the bypass it exists to catch. Fix the check." >&2
  exit 1
fi
echo "✔ the check failed against the restored defect, as it must (exit $status)"
