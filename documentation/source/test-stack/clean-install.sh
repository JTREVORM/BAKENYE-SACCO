#!/bin/bash
# Clean-installation test: a brand-new database, the current migrations, the
# first administrator, and the current seed. Nothing carried over.
set -e
ST=/var/tmp/bud-docs-stack
DB=budsacco_clean
PSQL="psql -v ON_ERROR_STOP=1 -q postgresql://postgres@127.0.0.1:54322"

echo "── dropping and recreating $DB"
$PSQL/postgres -c "drop database if exists $DB;" 
$PSQL/postgres -c "create database $DB;"

echo "── supabase-compatible bootstrap (auth schema, API roles)"
$PSQL/$DB -f $ST/00_bootstrap.sql > /dev/null
$PSQL/$DB -f $ST/01_storage.sql > /dev/null

echo "── migrations"
n=0
for f in /home/user/BAKENYE-SACCO/supabase/migrations/*.sql; do
  $PSQL/$DB -f "$f" > /dev/null || { echo "   ✖ FAILED: $(basename $f)"; exit 1; }
  n=$((n+1))
done
echo "   ✔ $n migrations applied"

echo "── grants the hosted project gives service_role"
$PSQL/$DB -c "grant all on all tables in schema public to service_role;
              grant all on all sequences in schema public to service_role;
              grant all on all functions in schema public to service_role;" > /dev/null

echo "── first administrator"
$PSQL/$DB -c "
do \$\$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v, 'authenticated', 'authenticated', 'clean.admin@test.invalid', '', now(),
          jsonb_build_object('role','super_admin'),
          jsonb_build_object('full_name','Clean Install Admin'), now(), now());
  update app_users set must_change_password = false where id = v;
end \$\$;" > /dev/null
echo "   ✔ super admin provisioned by the auth trigger: $($PSQL/$DB -t -A -c "select count(*) from app_users where role='super_admin' and is_active;")"

echo "── seed"
$PSQL/$DB -f /home/user/BAKENYE-SACCO/supabase/seed.sql 2>&1 | grep -iE "^psql.*(ERROR|FATAL)" && { echo "   ✖ SEED FAILED"; exit 1; }
echo "   ✔ seed applied"

echo "── what the clean database holds"
$PSQL/$DB -t -A -F'|' -c "
select 'members', count(*) from members
union all select 'transactions', count(*) from transactions
union all select 'loans', count(*) from loans
union all select 'loan products', count(*) from loan_products
union all select 'savings periods', count(*) from savings_periods
union all select 'savings plans (backdated)', count(*) from savings_plans where active_from < current_date
union all select 'future-dated entries', count(*) from transactions where occurred_on > current_date
union all select 'accounts', count(*) from financial_accounts;"
