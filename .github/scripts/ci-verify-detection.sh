#!/usr/bin/env bash
# Prove the password-security check can still FAIL — and fail for the right reason.
#
# F-14's finding was not that a test was missing, it was that a passing test
# proved nothing: the temporary-password suite passed 16/16 while the bypass
# stood wide open, because it never attempted the bypass. A security test that
# cannot fail when the control is broken is worse than no test, because it buys
# false confidence.
#
# So: copy the database, put the vulnerable pre-0049 function back, point the
# check at it, and require the check to report the specific security assertions
# the defect breaks.
#
# TWO THINGS THIS SCRIPT GETS RIGHT THAT THE FIRST VERSION DID NOT
#
#  1. PostgREST is stopped, and its sessions terminated, BEFORE the template
#     copy is made. `create database ... template budsacco_ci` needs the source
#     database to have no other sessions on it, and PostgREST holds a pool
#     open. On run 39789916492 this failed with "source database is being
#     accessed by other users. DETAIL: There are 2 other sessions".
#
#  2. Detection is asserted BY NAME, not by exit code. Any non-zero exit used to
#     count as "the check detects the vulnerability" — so a missing module, a
#     refused connection, or the very database error in (1) would have been
#     recorded as proof. `assert-detection-report.mjs` now requires the run to
#     have completed, the five assertions the defect breaks to have failed, and
#     the seven that prove the harness worked to have passed.
set -euo pipefail

DB_URL="${CI_DATABASE_URL:?CI_DATABASE_URL must be set}"
ADMIN_URL="${DB_URL%/*}/postgres"
VULN_URL="${DB_URL%/*}/budsacco_ci_vuln"
PSQL="psql -v ON_ERROR_STOP=1 -q"
REPORT=/tmp/detection-report.json

rm -f "$REPORT"

# --------------------------------------------------------------------------
# Stop PostgREST and wait for the process to be gone, not merely signalled.
# --------------------------------------------------------------------------
stop_postgrest() {
  pkill -x postgrest 2>/dev/null || true
  for _ in $(seq 1 30); do
    pgrep -x postgrest > /dev/null 2>&1 || return 0
    sleep 1
  done
  echo "✖ PostgREST would not stop; refusing to continue" >&2
  return 1
}

start_postgrest() {
  /tmp/postgrest/postgrest /tmp/postgrest.conf > "$1" 2>&1 &
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://127.0.0.1:3001/" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo "✖ PostgREST did not start" >&2
  cat "$1" >&2
  return 1
}

# Any session on the source database defeats a template copy, so clear them.
terminate_sessions_on() {
  $PSQL "$ADMIN_URL" -c "
    select pg_terminate_backend(pid) from pg_stat_activity
     where datname = '$1' and pid <> pg_backend_pid();" > /dev/null
}

echo "── stopping PostgREST so the source database has no sessions on it"
stop_postgrest
terminate_sessions_on budsacco_ci

echo "── a throwaway copy with the defect put back"
$PSQL "$ADMIN_URL" -c "drop database if exists budsacco_ci_vuln;" > /dev/null

# One retry, in case a connection was in the act of closing. If it still fails
# the script stops here rather than letting the error look like a detection.
created=0
for attempt in 1 2 3; do
  if $PSQL "$ADMIN_URL" -c "create database budsacco_ci_vuln template budsacco_ci;" > /dev/null 2>/tmp/createdb.err; then
    created=1
    break
  fi
  echo "   attempt $attempt could not copy the database:"
  sed 's/^/   /' /tmp/createdb.err
  terminate_sessions_on budsacco_ci
  sleep 2
done
if [ "$created" -ne 1 ]; then
  echo "✖ could not create budsacco_ci_vuln from budsacco_ci." >&2
  echo "  Without the copy there is nothing to restore the defect into, so this" >&2
  echo "  job cannot prove anything. It fails rather than passing on a crash." >&2
  $PSQL "$ADMIN_URL" -c "select datname, count(*) from pg_stat_activity where datname is not null group by 1;" >&2 || true
  exit 1
fi

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

# Confirm the defect really is back before concluding anything from its absence.
restored=$($PSQL "$VULN_URL" -t -A -c "
  select (prosrc like '%must_change_password = false%')
         and has_function_privilege('authenticated','public.log_password_changed()','execute')
    from pg_proc where proname = 'log_password_changed';")
if [ "$restored" != "t" ]; then
  echo "✖ the F-01 defect was not restored on the copy, so the run below would" >&2
  echo "  prove nothing. Expected a flag-clearing log_password_changed() granted" >&2
  echo "  to authenticated; got '$restored'." >&2
  exit 1
fi
echo "   ✔ the pre-0049 log_password_changed() is back and callable by authenticated"

echo "── pointing PostgREST at the vulnerable copy"
stop_postgrest
sed -i 's|/budsacco_ci"|/budsacco_ci_vuln"|' /tmp/postgrest.conf
start_postgrest /tmp/postgrest-vuln.log

echo "── the check must now report the expected security failures"
set +e
REST_DATABASE_URL="$VULN_URL" REST_REPORT="$REPORT" \
  node scripts/password-security-rest-check.mjs
status=$?
set -e
echo "   (the check exited $status, which on its own proves nothing)"

echo "── asserting WHICH assertions failed"
assert_status=0
node .github/scripts/assert-detection-report.mjs "$REPORT" || assert_status=$?

# Leave the runner as we found it, whatever the outcome above: the vulnerable
# copy gone and PostgREST answering on the clean database again. This step
# happens to be the last one in the job today, but a step added after it should
# not fail for reasons this script left behind.
echo "── putting the runner back"
stop_postgrest
sed -i 's|/budsacco_ci_vuln"|/budsacco_ci"|' /tmp/postgrest.conf
terminate_sessions_on budsacco_ci_vuln
$PSQL "$ADMIN_URL" -c "drop database if exists budsacco_ci_vuln;" > /dev/null || true
start_postgrest /tmp/postgrest-restored.log
echo "   ✔ PostgREST is back on budsacco_ci and the vulnerable copy is gone"

exit "$assert_status"
