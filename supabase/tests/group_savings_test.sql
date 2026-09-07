begin;

create temp table t_result (n serial, step text, ok boolean, detail text);

do $$
declare
  v_group   uuid;
  v_code    text;
  v_res     jsonb;
  v_cycle   uuid;
  v_ids     uuid[] := '{}';
  v_id      uuid;
  v_sched   uuid;
  v_sched2  uuid;
  v_sched3  uuid;
  v_sum     record;
  v_i       integer;
  v_txn     text;
  v_txn2    text;
  v_err     text;
  v_wed     date;
  v_admin_user  uuid;
  v_member_user uuid;
begin
  -- The saving day is data, so pick day 3 (Wednesday). Use the most recent
  -- Wednesday that has actually happened: a payment cannot be dated in the
  -- future, and this suite must give the same result whichever day it runs on.
  v_wed := date_trunc('week', current_date)::date + 2;
  if v_wed > current_date then
    v_wed := v_wed - 7;
  end if;
  v_admin_user := auth.uid();
  select id into v_member_user from app_users where role = 'member' and is_active limit 1;

  ---------------------------------------------------------------- Scenario 1
  v_res := create_group('TEST Bakenye Central', 3::smallint, 'weekly',
                        'Kampala', 20000, 0, null, null, null, 'automated test');
  v_group := (v_res ->> 'group_id')::uuid;
  v_code  := v_res ->> 'group_code';
  insert into t_result (step, ok, detail)
  values ('1a create group', v_group is not null,
          format('%s / saving day %s', v_code,
                 (select saving_day_label(saving_day) from sacco_groups where id = v_group)));

  for v_i in 1..25 loop
    v_res := create_member(
      format('Test Member%s Kato%s', v_i, v_i),
      format('+2567710%s', lpad(v_i::text, 5, '0')),
      null, null, 'Kampala', null, null, null, null, null, null, null, null);
    v_id := (v_res ->> 'member_id')::uuid;
    v_ids := v_ids || v_id;
    perform assign_member_group(v_id, v_group, 'automated test');
  end loop;

  insert into t_result (step, ok, detail)
  select '1b 25 members in group', count(*) = 25, count(*) || ' members'
    from members where group_id = v_group and status = 'active';

  ---------------------------------------------------------------- Scenario 2
  v_res  := open_group_cycle(v_group, v_wed);
  v_cycle := (v_res ->> 'cycle_id')::uuid;

  select * into v_sum from group_cycle_summary where cycle_id = v_cycle;
  insert into t_result (step, ok, detail)
  values ('2a cycle opened', v_cycle is not null,
          format('%s due %s', v_sum.label, v_sum.due_on));
  insert into t_result (step, ok, detail)
  values ('2b expected = 25 x 20,000', v_sum.expected_amount = 500000,
          format('%s members, expected %s', v_sum.members_expected, v_sum.expected_amount));
  insert into t_result (step, ok, detail)
  values ('2c due date is the Wednesday', extract(isodow from v_sum.due_on)::int = 3,
          v_sum.due_on::text);

  -- Re-running must not duplicate anything.
  perform open_group_cycle(v_group, v_wed);
  select * into v_sum from group_cycle_summary where cycle_id = v_cycle;
  insert into t_result (step, ok, detail)
  values ('2d reopening is idempotent', v_sum.members_expected = 25,
          v_sum.members_expected || ' schedules');

  ---------------------------------------------------------------- Scenario 3
  select id into v_sched from savings_periods
   where cycle_id = v_cycle and member_id = v_ids[1];

  v_res := record_scheduled_savings(v_sched, 20000, v_wed, 'cash', 'TEST-REF-001',
                                    'full payment', 'test:full:1');
  v_txn := v_res ->> 'reference';
  insert into t_result (step, ok, detail)
  values ('3a full payment -> paid', v_res ->> 'status' = 'paid',
          format('%s outstanding %s', v_res ->> 'reference', v_res ->> 'outstanding'));

  insert into t_result (step, ok, detail)
  select '3b ledger row written', count(*) = 1, count(*)::text
    from transactions where reference = v_txn and status = 'posted' and amount = 20000;

  insert into t_result (step, ok, detail)
  select '3c member balance from ledger', savings_balance = 20000, savings_balance::text
    from member_savings where member_id = v_ids[1];

  insert into t_result (step, ok, detail)
  select '3d payment intent settled', count(*) = 1,
         coalesce(max(provider::text || '/' || state::text), 'none')
    from payment_intents where schedule_id = v_sched;

  select * into v_sum from group_cycle_summary where cycle_id = v_cycle;
  insert into t_result (step, ok, detail)
  values ('3e group total from members', v_sum.collected_amount = 20000,
          format('collected %s of %s (%s%%)', v_sum.collected_amount,
                 v_sum.expected_amount, v_sum.collection_rate));

  ---------------------------------------------------------------- Scenario 4
  select id into v_sched2 from savings_periods
   where cycle_id = v_cycle and member_id = v_ids[2];
  v_res := record_scheduled_savings(v_sched2, 10000, v_wed, 'mobile_money',
                                    'TEST-REF-002', null, 'test:partial:2');
  insert into t_result (step, ok, detail)
  values ('4 partial -> partial, 10,000 outstanding',
          v_res ->> 'status' = 'partial' and (v_res ->> 'outstanding')::numeric = 10000,
          format('paid %s outstanding %s', v_res ->> 'paid', v_res ->> 'outstanding'));

  ---------------------------------------------------------------- Scenario 6
  -- Same idempotency key: must return the original row, not post twice.
  v_res := record_scheduled_savings(v_sched, 20000, v_wed, 'cash', null, null, 'test:full:1');
  v_txn2 := v_res ->> 'reference';
  insert into t_result (step, ok, detail)
  values ('6a duplicate idempotency key is a no-op', v_txn2 = v_txn,
          format('%s vs %s', v_txn, v_txn2));

  insert into t_result (step, ok, detail)
  select '6b still one ledger row', count(*) = 1, count(*)::text
    from savings_payments where period_id = v_sched;

  -- Same external reference on a different payment: must be refused.
  begin
    perform record_scheduled_savings(v_sched2, 5000, v_wed, 'mobile_money',
                                     'test-ref-001', null, 'test:dupref:9');
    insert into t_result (step, ok, detail)
    values ('6c duplicate external reference refused', false, 'it was accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('6c duplicate external reference refused', true, v_err);
  end;

  -- Zero and negative amounts.
  begin
    perform record_scheduled_savings(v_sched2, 0, v_wed, 'cash', null, null, 'test:zero');
    insert into t_result (step, ok, detail) values ('6d zero amount refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('6d zero amount refused', true, v_err);
  end;

  -- Future-dated payment.
  begin
    perform record_scheduled_savings(v_sched2, 5000, current_date + 3, 'cash',
                                     null, null, 'test:future');
    insert into t_result (step, ok, detail) values ('6e future date refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('6e future date refused', true, v_err);
  end;

  ---------------------------------------------------------------- Scenario 5
  select id into v_sched3 from savings_periods
   where cycle_id = v_cycle and member_id = v_ids[3];

  -- Backdate the due date so maintenance sees it as elapsed.
  update savings_periods set due_on = current_date - 1 where id = v_sched3;
  perform run_daily_maintenance();

  insert into t_result (step, ok, detail)
  select '5a unpaid past due -> missed', status = 'missed', status::text
    from savings_periods where id = v_sched3;

  insert into t_result (step, ok, detail)
  select '5b missed schedule still visible with its shortfall',
         outstanding = 20000, format('%s outstanding %s', status, outstanding)
    from savings_schedules where schedule_id = v_sched3;

  ---------------------------------------------------------------- Waiver
  begin
    perform waive_savings_schedule(v_sched, 'test');
    insert into t_result (step, ok, detail)
    values ('7a cannot waive a paid schedule', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('7a cannot waive a paid schedule', true, v_err);
  end;

  ------------------------------------------------------- Today / dashboard
  v_res := groups_saving_on(v_wed);
  insert into t_result (step, ok, detail)
  values ('8a group appears on its saving day',
          v_res @> jsonb_build_array(jsonb_build_object('group_id', v_group)),
          jsonb_array_length(v_res) || ' group(s) collecting');

  v_res := groups_saving_on(v_wed + 1);
  insert into t_result (step, ok, detail)
  values ('8b group absent on other days',
          not (v_res @> jsonb_build_array(jsonb_build_object('group_id', v_group))),
          jsonb_array_length(v_res) || ' group(s) collecting on the Thursday');

  v_res := savings_dashboard(v_wed);
  insert into t_result (step, ok, detail)
  values ('8c dashboard figures come from the schedules',
          (v_res ->> 'today_expected')::numeric >= 500000
          and (v_res ->> 'today_collected')::numeric >= 30000,
          format('expected %s collected %s rate %s%%',
                 v_res ->> 'today_expected', v_res ->> 'today_collected',
                 v_res ->> 'collection_rate'));

  ------------------------------------------------------------ Collection sheet
  v_res := group_collection_sheet(v_group, v_cycle);
  insert into t_result (step, ok, detail)
  values ('9a collection sheet lists every member',
          jsonb_array_length(v_res -> 'rows') = 25,
          jsonb_array_length(v_res -> 'rows') || ' rows');

  ------------------------------------------------------------ Group report
  v_res := group_report(v_group, v_wed - 7, v_wed + 7);
  insert into t_result (step, ok, detail)
  values ('9b group report totals match the cycle',
          (v_res -> 'totals' ->> 'expected')::numeric = 500000,
          format('expected %s paid %s rate %s%%',
                 v_res -> 'totals' ->> 'expected',
                 v_res -> 'totals' ->> 'paid',
                 v_res ->> 'collection_rate'));

  ------------------------------------------------------------ Ledger
  v_res := member_statement(v_ids[1], v_wed - 30, v_wed + 1);
  insert into t_result (step, ok, detail)
  values ('10 member ledger shows the running balance',
          (v_res -> 'rows' -> 0 ->> 'running_balance')::numeric = 20000,
          format('%s row(s), closing %s', jsonb_array_length(v_res -> 'rows'),
                 v_res -> 'rows' -> -1 ->> 'running_balance'));

  --------------------------------------------------------- Cycle close
  -- run_daily_maintenance() above already swept the elapsed schedules, so the
  -- close finds nothing left pending. What matters is the end state.
  v_res := close_savings_cycle(v_cycle, 'test close');
  select * into v_sum from group_cycle_summary where cycle_id = v_cycle;
  insert into t_result (step, ok, detail)
  values ('11a cycle closes with every schedule accounted for',
          v_sum.status = 'closed'
          and v_sum.paid_members + v_sum.partial_members
              + v_sum.missed_members + v_sum.pending_members
              + v_sum.waived_members = 25
          and v_sum.pending_members = 0,
          format('%s paid, %s partial, %s missed, %s pending, outstanding %s',
                 v_sum.paid_members, v_sum.partial_members, v_sum.missed_members,
                 v_sum.pending_members, v_sum.outstanding_amount));

  begin
    perform record_scheduled_savings(v_sched2, 5000, v_wed, 'cash', null, null, 'test:closed');
    insert into t_result (step, ok, detail)
    values ('11b closed cycle refuses payments', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('11b closed cycle refuses payments', true, v_err);
  end;

  ---------------------------------------------------------------- Scenario 7
  -- Become an ordinary member and try to move money.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member_user, 'role', 'authenticated')::text, true);

  insert into t_result (step, ok, detail)
  values ('12a member holds no operational capability',
          not can_view_operations() and not can_record_savings() and not can_manage_groups(),
          format('view=%s record=%s manage=%s',
                 can_view_operations(), can_record_savings(), can_manage_groups()));

  begin
    perform record_scheduled_savings(v_sched3, 20000, v_wed, 'cash', null, null, 'test:unauth');
    insert into t_result (step, ok, detail)
    values ('12b member cannot record savings', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('12b member cannot record savings', true, v_err);
  end;

  begin
    perform create_group('TEST Unauthorised', 1::smallint, 'weekly',
                         null, 0, 0, null, null, null, null);
    insert into t_result (step, ok, detail)
    values ('12c member cannot create groups', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('12c member cannot create groups', true, v_err);
  end;

  begin
    perform savings_dashboard(v_wed);
    insert into t_result (step, ok, detail)
    values ('12d member cannot read the savings dashboard', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('12d member cannot read the savings dashboard', true, v_err);
  end;

  begin
    perform savings_performance('weekly', v_wed - 30, v_wed, null, null);
    insert into t_result (step, ok, detail)
    values ('12e member cannot read savings of others', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('12e member cannot read savings of others', true, v_err);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_user, 'role', 'authenticated')::text, true);
end;
$$;

select n, step, case when ok then 'PASS' else 'FAIL' end as result, detail
  from t_result order by n;

rollback;
