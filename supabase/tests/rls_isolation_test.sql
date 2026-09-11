begin;

create temp table t_result (n serial, step text, ok boolean, detail text);

-- ===========================================================================
-- Row-level security: a member reads their own rows, the loans they guarantee,
-- and nothing else.
--
-- This suite exists because the policies on `loans` and `loan_guarantors` used
-- to read each other's tables, which made every read of `loans` fail with
-- "infinite recursion detected in policy". 0012 broke the cycle with
-- SECURITY DEFINER helpers; these checks prove both that the reads work and
-- that they are still scoped.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Fixture: one member who has a login.
--
-- The suite signs in as that member to prove the policies scope what they can
-- read, so it needs one to exist. A seeded database has one; a database whose
-- demo data has been cleared has only staff logins, and the suite then skipped
-- itself - which hides every check below it. Create a throwaway member
-- instead. Like everything else in this file it is rolled back at the end.
--
-- Creating an auth user needs more than the `authenticated` role the runner
-- switches to, so the role is dropped for the length of the insert only.
-- ---------------------------------------------------------------------------
reset role;

do $fixture$
declare
  v_uid uuid := gen_random_uuid();
  v_mid uuid;
begin
  if exists (
    select 1 from members m
      join app_users u on u.id = m.user_id
     where u.role = 'member' and u.is_active and not u.must_change_password
  ) then
    return;
  end if;

  v_mid := (register_member(jsonb_build_object(
              'full_name', 'Test Signed-In Member', 'phone', '+256779000002',
              'share_category_id', (select id from share_categories where status = 'active' order by sort_order limit 1),
              'savings_category_id', (select id from savings_categories where status = 'active' order by sort_order limit 1)))
            ->> 'member_id')::uuid;

  -- A member login names its member in app metadata, exactly as the sign-in
  -- action creates it; the on_auth_user_created trigger links the two.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data,
                          raw_user_meta_data, created_at, updated_at)
  values (v_uid, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'rls.fixture@test.invalid', '',
          now(), jsonb_build_object('member_id', v_mid),
          '{}'::jsonb, now(), now());

  -- A new login starts on a temporary password and can read nothing until it
  -- is changed; this fixture stands for a member who has already changed it.
  update app_users set must_change_password = false where id = v_uid;
end;
$fixture$;

set role authenticated;

do $$
declare
  v_admin      uuid;
  v_member_user uuid;
  v_self       uuid;     -- the member linked to v_member_user
  v_other      uuid;     -- a member with no login at all
  v_savings_cat uuid;
  v_share_cat  uuid;
  v_product    uuid;
  v_loan       uuid;
  v_res        jsonb;
  v_count      integer;
  v_err        text;
  v_wed        date;
begin
  v_admin := auth.uid();

  select u.id, m.id into v_member_user, v_self
    from app_users u
    join members m on m.user_id = u.id
   where u.role = 'member' and u.is_active and not u.must_change_password
   limit 1;
  if v_self is null then
    insert into t_result (step, ok, detail)
    values ('0 a member with a login exists', false, 'no member is linked to a login');
    return;
  end if;

  v_wed := date_trunc('week', current_date)::date + 2;
  if v_wed > current_date then v_wed := v_wed - 7; end if;

  ------------------------------------------------------------------ set-up
  -- Both members save under the same category. Sharing a category must not
  -- make either of them visible to the other: a category is a rule they are
  -- both held to, not a group they both belong to.
  select id into v_savings_cat from savings_categories
   where status = 'active' and frequency = 'weekly'
   order by sort_order limit 1;
  select id into v_share_cat from share_categories
   where status = 'active' order by sort_order limit 1;

  v_res := register_member(jsonb_build_object(
             'full_name', 'Test Other Person', 'phone', '+256779000001',
             'share_category_id', v_share_cat, 'savings_category_id', v_savings_cat));
  v_other := (v_res ->> 'member_id')::uuid;
  -- Whatever registration fees this SACCO has configured are waived, so the
  -- fixture member is active and can save.
  perform waive_member_fee(mf.id, 'automated test fixture')
     from member_fees mf where mf.member_id = v_other and mf.status = 'unpaid';

  perform set_member_categories(v_other, v_share_cat, v_savings_cat, 'automated test');
  perform set_member_categories(v_self, v_share_cat, v_savings_cat, 'automated test');
  perform open_savings_schedules(v_wed);

  -- Money for the other member only, so anything the signed-in member can see
  -- of it is a leak.
  perform record_savings_payment(v_other, 'weekly', 15000, v_wed, 'cash', 'test:iso:1');

  select id into v_product from loan_products where code = 'EMG';
  v_res := apply_for_loan(v_other, v_product, 300000, 6, 'Test isolation loan', null,
                          jsonb_build_array(jsonb_build_object('member_id', v_self,
                                                               'amount', 300000)),
                          'test:iso:loan');
  v_loan := (v_res ->> 'loan_id')::uuid;

  insert into t_result (step, ok, detail)
  values ('1 set-up complete', v_loan is not null,
          format('two members in one savings category, one loan guaranteed by the other'));

  ------------------------------------------------- staff can read the lot
  select count(*) into v_count from loans;
  insert into t_result (step, ok, detail)
  values ('2a staff read loans without recursing', v_count >= 1, v_count || ' loan(s)');

  select count(*) into v_count from member_financials;
  insert into t_result (step, ok, detail)
  values ('2b staff read member_financials', v_count >= 2, v_count || ' member(s)');

  select count(*) into v_count from savings_category_summary;
  insert into t_result (step, ok, detail)
  values ('2c staff read savings_category_summary', v_count >= 1, v_count || ' category(ies)');

  select count(*) into v_count from member_share_progress;
  insert into t_result (step, ok, detail)
  values ('2d staff read member_share_progress', v_count >= 2, v_count || ' member(s)');

  ------------------------------------------------------- become the member
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member_user, 'role', 'authenticated')::text, true);

  select count(*) into v_count from members;
  insert into t_result (step, ok, detail)
  values ('3a member sees only themselves in members', v_count = 1, v_count || ' row(s)');

  select count(*) into v_count from member_financials;
  insert into t_result (step, ok, detail)
  values ('3b member sees only their own financials', v_count = 1, v_count || ' row(s)');

  select count(*) into v_count from savings_periods where member_id = v_other;
  insert into t_result (step, ok, detail)
  values ('3c member cannot see schedules of others', v_count = 0, v_count || ' row(s)');

  select count(*) into v_count from savings_payments where member_id = v_other;
  insert into t_result (step, ok, detail)
  values ('3d member cannot see payments of others', v_count = 0, v_count || ' row(s)');

  select count(*) into v_count from transactions where member_id = v_other;
  insert into t_result (step, ok, detail)
  values ('3e member cannot see the ledger of others', v_count = 0, v_count || ' row(s)');

  --------------------------------------------- loans: own + guaranteed only
  select count(*) into v_count from loans;
  insert into t_result (step, ok, detail)
  values ('4a member sees the loan they guarantee', v_count = 1,
          v_count || ' loan(s) visible');

  select count(*) into v_count from loans where id = v_loan;
  insert into t_result (step, ok, detail)
  values ('4b and it is the right one', v_count = 1, v_count || ' match(es)');

  select count(*) into v_count from loan_balances;
  insert into t_result (step, ok, detail)
  values ('4c loan_balances resolves without recursing', v_count = 1, v_count || ' row(s)');

  select count(*) into v_count from loan_guarantors;
  insert into t_result (step, ok, detail)
  values ('4d member sees the guarantee naming them', v_count = 1, v_count || ' row(s)');

  ---------------------------- categories are readable, other members are not
  -- The category register is deliberately open to any signed-in user: a member
  -- is entitled to know what their own tier expects of them. What must not leak
  -- is who else is in it, or what they have paid.
  select count(*) into v_count from savings_categories;
  insert into t_result (step, ok, detail)
  values ('5a member may read the savings category register', v_count >= 1,
          v_count || ' category(ies)');

  select count(*) into v_count from member_share_progress;
  insert into t_result (step, ok, detail)
  values ('5b member sees only their own share progress', v_count = 1, v_count || ' row(s)');

  select count(*) into v_count from savings_transactions where member_id <> v_self;
  insert into t_result (step, ok, detail)
  values ('5d member cannot see the savings transactions of others', v_count = 0,
          v_count || ' row(s)');

  select count(*) into v_count from savings_schedules;
  insert into t_result (step, ok, detail)
  values ('5c member sees only their own schedule rows', v_count >= 0 and not exists (
            select 1 from savings_schedules where member_id <> v_self),
          v_count || ' row(s), none belonging to anyone else');

  ------------------------------------------------------ books stay closed
  select count(*) into v_count from payment_intents where member_id = v_other;
  insert into t_result (step, ok, detail)
  values ('6a member cannot see payment intents of others', v_count = 0, v_count || ' row(s)');

  select count(*) into v_count from audit_logs;
  insert into t_result (step, ok, detail)
  values ('6b member cannot read the audit log', v_count = 0, v_count || ' row(s)');

  select count(*) into v_count from income_entries;
  insert into t_result (step, ok, detail)
  values ('6c member cannot read the SACCO books', v_count = 0, v_count || ' row(s)');

  ------------------------------------------- statements are self-service only
  begin
    perform member_statement(v_other, v_wed - 30, v_wed);
    insert into t_result (step, ok, detail)
    values ('7 member cannot pull the statement of another', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('7 member cannot pull the statement of another', true, v_err);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
end;
$$;

select n, step, case when ok then 'PASS' else 'FAIL' end as result, detail
  from t_result order by n;

rollback;
