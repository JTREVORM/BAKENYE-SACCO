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
do $$
declare
  v_admin      uuid;
  v_member_user uuid;
  v_self       uuid;     -- the member linked to v_member_user
  v_other      uuid;     -- a member with no login at all
  v_group      uuid;
  v_product    uuid;
  v_loan       uuid;
  v_res        jsonb;
  v_count      integer;
  v_err        text;
  v_wed        date;
begin
  v_admin := auth.uid();

  select id into v_member_user from app_users where role = 'member' and is_active limit 1;
  select id into v_self from members where user_id = v_member_user;
  if v_self is null then
    insert into t_result (step, ok, detail)
    values ('0 a member with a login exists', false, 'no member is linked to a login');
    return;
  end if;

  v_wed := date_trunc('week', current_date)::date + 2;
  if v_wed > current_date then v_wed := v_wed - 7; end if;

  ------------------------------------------------------------------ set-up
  v_res := create_group('TEST Isolation Group', 3::smallint, 'weekly',
                        null, 15000, 0, null, null, null, 'automated test');
  v_group := (v_res ->> 'group_id')::uuid;

  v_res := create_member('Test Other Person', '+256779000001',
                         null, null, null, null, null, null, null, null, null, null, null);
  v_other := (v_res ->> 'member_id')::uuid;

  perform assign_member_group(v_other, v_group, 'automated test');
  perform assign_member_group(v_self, v_group, 'automated test');
  perform open_group_cycle(v_group, v_wed);

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
          format('two members in one group, one loan guaranteed by the other'));

  ------------------------------------------------- staff can read the lot
  select count(*) into v_count from loans;
  insert into t_result (step, ok, detail)
  values ('2a staff read loans without recursing', v_count >= 1, v_count || ' loan(s)');

  select count(*) into v_count from member_financials;
  insert into t_result (step, ok, detail)
  values ('2b staff read member_financials', v_count >= 2, v_count || ' member(s)');

  select count(*) into v_count from group_overview;
  insert into t_result (step, ok, detail)
  values ('2c staff read group_overview', v_count >= 1, v_count || ' group(s)');

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

  ------------------------------------------------- group visibility is own
  select count(*) into v_count from sacco_groups;
  insert into t_result (step, ok, detail)
  values ('5a member sees only their own group', v_count = 1, v_count || ' group(s)');

  select count(*) into v_count from savings_cycles;
  insert into t_result (step, ok, detail)
  values ('5b member sees the cycles of their group', v_count >= 1, v_count || ' cycle(s)');

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
