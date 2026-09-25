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
     where u.role = 'member' and u.is_active and not u.must_change_password and m.status = 'active'
  ) then
    return;
  end if;

  v_mid := (register_member(jsonb_build_object(
              'full_name', 'Test Signed-In Member', 'phone', '+256779000002'))
            ->> 'member_id')::uuid;

  -- Whatever registration fee this SACCO charges is waived for the fixture, so
  -- the member is active and the checks below have something to read.
  perform waive_member_fee(mf.id, 'automated test fixture')
     from member_fees mf where mf.member_id = v_mid and mf.status = 'unpaid';

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
   where u.role = 'member' and u.is_active and not u.must_change_password and m.status = 'active'
   limit 1;
  if v_self is null then
    insert into t_result (step, ok, detail)
    values ('0 a member with a login exists', false, 'no member is linked to a login');
    return;
  end if;

  v_wed := date_trunc('week', current_date)::date + 2;
  if v_wed > current_date then v_wed := v_wed - 7; end if;

  ------------------------------------------------------------------ set-up
  -- Two members saving on the same open monthly footing. Saving alongside
  -- somebody must not make either of them visible to the other.
  v_res := register_member(jsonb_build_object(
             'full_name', 'Test Other Person', 'phone', '+256779000001'));
  v_other := (v_res ->> 'member_id')::uuid;
  -- Whatever registration fees this SACCO has configured are waived, so the
  -- fixture member is active and can save.
  perform waive_member_fee(mf.id, 'automated test fixture')
     from member_fees mf where mf.member_id = v_other and mf.status = 'unpaid';

  perform open_savings_schedules(v_wed);

  -- Money for the other member only, so anything the signed-in member can see
  -- of it is a leak.
  perform record_savings_payment(v_other, 'weekly', 15000, v_wed, 'cash', 'test:iso:1');

  -- The suite brings its own loan product rather than relying on one the SACCO
  -- happens to have configured; a fresh installation has none. The whole run
  -- is rolled back, so it never survives.
  v_res := save_loan_product(null, jsonb_build_object(
             'name', 'TEST Isolation Loan', 'code', 'TESTISO', 'interest_rate', 12,
             'interest_method', 'flat', 'min_amount', 100000, 'max_amount', 1000000,
             'min_period_months', 1, 'max_period_months', 12, 'repayment_frequency', 'monthly',
             'processing_fee_pct', 0, 'insurance_fee_pct', 0, 'application_fee', 0,
             'late_penalty_pct', 0, 'penalty_basis', 'overdue', 'grace_period_days', 0,
             'min_savings_balance', 0, 'min_savings_multiple', 0, 'min_membership_months', 0,
             'required_shares', 0, 'requires_guarantors', true, 'min_guarantors', 1,
             'requires_collateral', false, 'is_active', true, 'sort_order', 999),
             'automated test fixture');
  v_product := (v_res ->> 'id')::uuid;
  v_res := apply_for_loan(v_other, v_product, 300000, 6, 'Test isolation loan', null,
                          jsonb_build_array(jsonb_build_object('member_id', v_self,
                                                               'amount', 300000)),
                          'test:iso:loan');
  v_loan := (v_res ->> 'loan_id')::uuid;

  insert into t_result (step, ok, detail)
  values ('1 set-up complete', v_loan is not null,
          format('two members saving on the same open footing, one loan guaranteed by the other'));

  ------------------------------------------------- staff can read the lot
  select count(*) into v_count from loans;
  insert into t_result (step, ok, detail)
  values ('2a staff read loans without recursing', v_count >= 1, v_count || ' loan(s)');

  select count(*) into v_count from member_financials;
  insert into t_result (step, ok, detail)
  values ('2b staff read member_financials', v_count >= 2, v_count || ' member(s)');

  select count(*) into v_count from savings_schedules;
  insert into t_result (step, ok, detail)
  values ('2c staff read savings_schedules', v_count >= 1, v_count || ' period(s)');

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
  -- The member may have loans of their own as well; what must never appear
  -- is a loan that is neither theirs nor one they guarantee.
  select count(*) into v_count from loans l
   where l.member_id <> v_self
     and not exists (select 1 from loan_guarantors g
                      where g.loan_id = l.id and g.member_id = v_self);
  insert into t_result (step, ok, detail)
  values ('4a member sees only their own loans and the ones they guarantee', v_count = 0,
          v_count || ' other loan(s) visible');

  select count(*) into v_count from loans where id = v_loan;
  insert into t_result (step, ok, detail)
  values ('4b and it is the right one', v_count = 1, v_count || ' match(es)');

  select count(*) into v_count from loan_balances b
   where b.member_id = v_self
      or b.loan_id in (select g.loan_id from loan_guarantors g where g.member_id = v_self);
  insert into t_result (step, ok, detail)
  values ('4c loan_balances resolves without recursing',
          v_count >= 1 and v_count = (select count(*) from loan_balances), v_count || ' row(s)');

  select count(*) into v_count from loan_guarantors g
   where g.loan_id = v_loan and g.member_id = v_self;
  insert into t_result (step, ok, detail)
  values ('4d member sees the guarantee naming them', v_count = 1, v_count || ' row(s)');

  select count(*) into v_count from loan_guarantors g
   where g.member_id <> v_self
     and g.loan_id not in (select id from loans where member_id = v_self);
  insert into t_result (step, ok, detail)
  values ('4e member sees no guarantee between other people', v_count = 0, v_count || ' row(s)');

  ------------------- the retired registers stay readable, members do not leak
  -- The two category tables were retired by 0043 and their rows kept, so a
  -- historical record that names a tier can still resolve the name. They stay
  -- readable to any signed-in user, exactly as before; what must not leak is
  -- who else is a member, or what anybody else has paid.
  select count(*) into v_count from savings_categories;
  insert into t_result (step, ok, detail)
  values ('5a member may still read the retired category register', v_count >= 0,
          v_count || ' retired category(ies)');

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
