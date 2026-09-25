begin;

create temp table t_result (n serial, step text, ok boolean, detail text);
create temp table t_ctx (key text primary key, id uuid, txt text);
grant all on t_result, t_ctx to authenticated;
grant usage on sequence t_result_n_seq to authenticated;

-- ===========================================================================
-- Members, registration, fees, profile control, sign-in and access.
--
-- The brief's own test scenario, end to end, as a real signed-in Super Admin,
-- inside a transaction that is always rolled back:
--
--   Admin registers John Bakenye, 0700000000, Gold saver, Silver shares, with
--   a UGX 20,000 Membership Fee and a UGX 5,000 Registration Fee paid by
--   mobile money. Then: the member number, the receipt, the fee lines, Cash at
--   Merchant +25,000, the audit trail; a merchant-to-bank transfer that leaves
--   total funds unchanged; a fee increase that leaves John's receipt alone; John
--   signing in with his number and phone and being unable to change his own
--   record by any route; and an admin changing it, with the change on record.
-- ===========================================================================

set role authenticated;

do $$
declare
  v_admin     uuid := auth.uid();
  v_mer       uuid;
  v_bank      uuid;
  v_member_fee uuid;
  v_reg_fee   uuid;
  v_res       jsonb;
  v_john      members;
  v_txn       transactions;
  v_mer0      numeric;
  v_total0    numeric;
  v_err       text;
  v_n         integer;
  v_pending   uuid;
  v_charge    uuid;
  r           record;
begin
  -- Rules this suite asserts against, set explicitly.
  perform update_settings(jsonb_build_object(
    'members.activation_requires_fees', true,
    'treasury.require_approval', false,
    'treasury.four_eyes', false,
    'treasury.allow_negative_balances', false), 'members test');

  -- Whatever registration fees the live SACCO has are set aside for the
  -- length of the test, so the totals below are the test's own.
  for r in select id from fees where status = 'active' loop
    perform set_fee_status(r.id, 'inactive', 'members test');
  end loop;

  v_mer  := (create_financial_account('merchant', 'TEST Merchant (members)', 'MTN Mobile Money',
                                      'TEST-MC-M1', '0770000009') ->> 'id')::uuid;
  v_bank := (create_financial_account('bank', 'TEST Bank (members)', null, null, null,
                                      'Test Bank Uganda', 'Kampala', '000999888') ->> 'id')::uuid;

  -- ---- Fees are configured, not coded --------------------------------------
  v_member_fee := (create_fee(jsonb_build_object(
    'name', 'TEST Membership Fee', 'amount', 20000, 'fee_type', 'membership',
    'charged_when', 'registration', 'is_mandatory', true,
    'applies_to_new_members', true, 'applies_to_existing_members', false)) ->> 'id')::uuid;
  v_reg_fee := (create_fee(jsonb_build_object(
    'name', 'TEST Registration Fee', 'amount', 5000, 'fee_type', 'registration',
    'charged_when', 'registration', 'is_mandatory', false,
    'applies_to_new_members', true, 'applies_to_existing_members', false)) ->> 'id')::uuid;

  select count(*), sum((f ->> 'amount')::numeric) into v_n, v_mer0
    from jsonb_array_elements(registration_fee_schedule()) f;
  insert into t_result (step, ok, detail)
  values ('1 the registration fee schedule is read from Settings -> Fees',
          v_n = 2 and v_mer0 = 25000, v_n || ' fees totalling ' || v_mer0);

  -- ---- Register John Bakenye -----------------------------------------------
  v_mer0   := finance_account_balance_at(v_mer);
  v_total0 := (treasury_summary() -> 'totals' ->> 'total')::numeric;

  v_res := register_member(
    jsonb_build_object('full_name', 'John Bakenye', 'phone', '0700000000'),
    array[v_reg_fee],
    jsonb_build_object('pay_now', true, 'account_id', v_mer, 'reference', 'MOMO-TEST-7001',
                       'amount_received', 25000),
    25000, 'members-test:john');

  select * into v_john from members where id = (v_res ->> 'member_id')::uuid;
  insert into t_ctx values ('john', v_john.id, v_john.member_no);

  insert into t_result (step, ok, detail)
  values ('2a a unique BND + year + sequence member number is generated',
          v_john.member_no ~ ('^BND' || to_char(current_date, 'YY') || '[0-9]{3,}$')
          and (select count(*) from members where member_no = v_john.member_no) = 1, v_john.member_no);
  insert into t_result (step, ok, detail)
  values ('2b the phone is stored in its one form', v_john.phone = '+256700000000', v_john.phone);
  insert into t_result (step, ok, detail)
  values ('2c a member registered now carries no savings or share category',
          v_john.savings_category_id is null and v_john.share_category_id is null, null);
  insert into t_result (step, ok, detail)
  values ('2d paid in full, so the member is active', v_john.status = 'active', v_john.status::text);
  insert into t_result (step, ok, detail)
  values ('2e Cash at Merchant rose by UGX 25,000', finance_account_balance_at(v_mer) = v_mer0 + 25000,
          finance_account_balance_at(v_mer)::text);

  select * into v_txn from transactions where id = (v_res -> 'payment' ->> 'transaction_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('2f one fee transaction of UGX 25,000 into the merchant account, with the MoMo reference',
          v_txn.type = 'fee' and v_txn.amount = 25000 and v_txn.destination_account_id = v_mer
          and v_txn.method = 'mobile_money' and v_txn.external_ref = 'MOMO-TEST-7001', v_txn.reference);
  insert into t_result (step, ok, detail)
  values ('2g a receipt is issued', (v_res -> 'payment' ->> 'receipt_no') like 'RCT' || to_char(current_date, 'YYMMDD') || '%',
          v_res -> 'payment' ->> 'receipt_no');
  insert into t_result (step, ok, detail)
  values ('2h the receipt carries both fee lines and the membership title',
          (select jsonb_array_length(receipt_for_transaction(v_txn.id) -> 'fee_lines')) = 2
          and receipt_for_transaction(v_txn.id) ->> 'receipt_title' = 'Membership Payment Receipt', null);
  insert into t_result (step, ok, detail)
  values ('2i the SACCO books both fees as income, separately',
          (select count(*) from income_entries where transaction_id = v_txn.id) = 2
          and (select sum(amount) from income_entries where transaction_id = v_txn.id) = 25000, null);
  insert into t_result (step, ok, detail)
  values ('2j the audit log records the registration, the payment and the activation',
          exists (select 1 from audit_logs where action = 'member.created' and record_id = v_john.id::text)
          and exists (select 1 from audit_logs where action = 'fees.payment_recorded' and record_id = v_txn.id::text)
          and exists (select 1 from audit_logs where action = 'member.activated' and record_id = v_john.id::text),
          null);
  insert into t_result (step, ok, detail)
  values ('2k a retried submission returns the same member, not a second one',
          (register_member(jsonb_build_object('full_name', 'John Bakenye', 'phone', '0700000000'),
                           array[v_reg_fee], null, 25000, 'members-test:john') ->> 'member_id')::uuid = v_john.id
          and (select count(*) from members where phone = '+256700000000') = 1, null);

  -- ---- Duplicates and validation -------------------------------------------
  begin
    perform register_member(jsonb_build_object('full_name', 'Jane Bakenye', 'phone', '+256 700 000 000'),
                            '{}', null, 20000);
    insert into t_result (step, ok, detail) values ('3a the same phone in another format is refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('3a the same phone in another format is refused', true, v_err);
  end;

  begin
    perform register_member(jsonb_build_object('full_name', 'Jane Bakenye', 'phone', '0123'),
                            '{}', null, 20000);
    insert into t_result (step, ok, detail) values ('3b an invalid phone is refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('3b an invalid phone is refused', true, v_err);
  end;

  -- No categories are asked for any more, so a member registered without one
  -- is an ordinary member, not a rejected form.
  v_res := register_member(jsonb_build_object('full_name', 'Uncategorised Person Test', 'phone', '0700000066'),
                           '{}', null, 20000);
  insert into t_result (step, ok, detail)
  values ('3c a member is registered with no category at all',
          (v_res ->> 'member_id') is not null
          and (select savings_category_id from members where id = (v_res ->> 'member_id')::uuid) is null,
          v_res ->> 'member_no');

  begin
    perform register_member(jsonb_build_object('full_name', 'Jane Bakenye', 'phone', '0700000077'),
                            '{}', null, 99999);
    insert into t_result (step, ok, detail) values ('3d a total the officer was not shown is refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('3d a total the officer was not shown is refused', true, v_err);
  end;

  begin
    perform register_member(jsonb_build_object('full_name', 'Jane Bakenye', 'phone', '0700000077'),
                            '{}', jsonb_build_object('pay_now', true, 'account_id', v_mer), 20000);
    insert into t_result (step, ok, detail) values ('3e a mobile money payment needs its reference', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('3e a mobile money payment needs its reference, and nothing is left half-made',
            not exists (select 1 from members where phone = '+256700000077'), v_err);
  end;

  -- ---- Pay later: pending until the mandatory fee is paid -------------------
  v_res := register_member(jsonb_build_object('full_name', 'Pending Person Test', 'phone', '0700000088'),
                           '{}', jsonb_build_object('pay_now', false), 20000);
  v_pending := (v_res ->> 'member_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('4a registered without payment, the member is pending',
          (select status from members where id = v_pending) = 'pending', v_res ->> 'status');

  begin
    perform set_member_status(v_pending, 'active', 'trying to skip the fee');
    insert into t_result (step, ok, detail) values ('4b a pending member cannot be activated with fees unpaid', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('4b a pending member cannot be activated with fees unpaid', true, v_err);
  end;

  select id into v_charge from member_fees where member_id = v_pending and status = 'unpaid';
  perform pay_member_fees(v_pending, array[v_charge], v_mer, null, current_date, 'MOMO-TEST-7002', 20000);
  insert into t_result (step, ok, detail)
  values ('4c paying the fee activates the member',
          (select status from members where id = v_pending) = 'active', null);

  -- ---- A fee change never rewrites history ---------------------------------
  perform update_fee(v_member_fee, jsonb_build_object(
    'name', 'TEST Membership Fee', 'amount', 30000, 'fee_type', 'membership',
    'charged_when', 'registration', 'is_mandatory', true,
    'applies_to_new_members', true, 'applies_to_existing_members', false), 'Board resolution');
  insert into t_result (step, ok, detail)
  values ('5a the new amount applies to the next registration',
          (select (f ->> 'amount')::numeric from jsonb_array_elements(registration_fee_schedule()) f
            where (f ->> 'id')::uuid = v_member_fee) = 30000, null);
  insert into t_result (step, ok, detail)
  values ('5b John''s charge and receipt keep UGX 20,000',
          (select amount from member_fees where member_id = v_john.id and fee_id = v_member_fee) = 20000
          and exists (select 1 from jsonb_array_elements(receipt_for_transaction(v_txn.id) -> 'fee_lines') l
                       where (l ->> 'amount')::numeric = 20000), null);
  insert into t_result (step, ok, detail)
  values ('5c the amount change is audited with before and after',
          exists (select 1 from audit_logs where action = 'fee.amount_changed' and record_id = v_member_fee::text
                    and (old_value ->> 'amount')::numeric = 20000 and (new_value ->> 'amount')::numeric = 30000), null);

  -- ---- Merchant -> bank: total funds unchanged ------------------------------
  v_mer0   := finance_account_balance_at(v_mer);
  v_total0 := (treasury_summary() -> 'totals' ->> 'total')::numeric;
  v_res := create_internal_transfer(v_mer, v_bank, 25000, current_date, 'MTN-WD-7001', 'SLIP-7001',
                                    'Registration fees banked', null, 'Cashier');
  insert into t_result (step, ok, detail)
  values ('6a the transfer completes', v_res ->> 'status' = 'completed', v_res ->> 'status');
  insert into t_result (step, ok, detail)
  values ('6b Cash at Merchant fell by UGX 25,000 and Cash at Bank rose by UGX 25,000',
          finance_account_balance_at(v_mer) = v_mer0 - 25000 and finance_account_balance_at(v_bank) = 25000, null);
  insert into t_result (step, ok, detail)
  values ('6c total SACCO funds did not change',
          (treasury_summary() -> 'totals' ->> 'total')::numeric = v_total0, v_total0::text);

  -- ---- An authorised edit is kept on the record ----------------------------
  perform update_member_profile(v_john.id, jsonb_build_object('phone', '0770000000'),
                                'Member lost the old SIM card');
  insert into t_result (step, ok, detail)
  values ('7a an admin can change a member''s phone',
          (select phone from members where id = v_john.id) = '+256770000000', null);
  insert into t_result (step, ok, detail)
  values ('7b the change is recorded field by field, with the old and new values and the reason',
          exists (select 1 from member_profile_changes
                   where member_id = v_john.id and field = 'phone'
                     and old_value = '0700 000 000' and new_value = '0770 000 000'
                     and reason = 'Member lost the old SIM card' and changed_by = v_admin), null);
  insert into t_result (step, ok, detail)
  values ('7c and in the audit log as a phone number change',
          exists (select 1 from audit_logs where action = 'member.phone_changed' and record_id = v_john.id::text), null);

  begin
    perform update_member_profile(v_john.id, jsonb_build_object('full_name', 'John Bakenye Jr.'), '');
    insert into t_result (step, ok, detail) values ('7d an edit without a reason is refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('7d an edit without a reason is refused', true, v_err);
  end;

  -- ---- Roles and permissions are data --------------------------------------
  v_res := create_role('TEST Branch Supervisor', 'Test role', array['members.create', 'fees.collect'], 'members test');
  insert into t_ctx values ('role', null, v_res ->> 'role');
  insert into t_ctx values ('reg_fee', v_reg_fee, null);
  insert into t_result (step, ok, detail)
  values ('8a a new role can be created with chosen permissions',
          (select count(*) from role_permissions where role_key = v_res ->> 'role') = 2, v_res ->> 'role');

  begin
    perform set_role_permissions('member', array['members.manage'], 'trying to give members a staff power');
    insert into t_result (step, ok, detail) values ('8b a member role can never hold a staff permission', false, 'granted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('8b a member role can never hold a staff permission', true, v_err);
  end;

  begin
    perform set_role_permissions('super_admin', array['members.view'], 'trying to shrink super admin');
    insert into t_result (step, ok, detail) values ('8c the Super Admin role cannot be edited', false, 'changed');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('8c the Super Admin role cannot be edited', true, v_err);
  end;

  perform set_role_permissions('cashier',
    (select array_agg(permission_key) from role_permissions where role_key = 'cashier' and permission_key <> 'fees.collect'),
    'members test');
  insert into t_result (step, ok, detail)
  values ('8d withdrawing a permission is audited with what was withdrawn',
          exists (select 1 from audit_logs where action = 'role.permissions_changed' and record_id = 'cashier'
                    and new_value -> 'withdrawn' ? 'fees.collect'), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign-in: one identifier field (member number, phone or email) and a password
-- the account holder chose with a one-time setup code. These functions belong
-- to the server and to Supabase Auth, so this block runs without the
-- `authenticated` role.
-- ---------------------------------------------------------------------------
reset role;

do $$
declare
  v_john_id uuid := (select id from t_ctx where key = 'john');
  v_no      text := (select txt from t_ctx where key = 'john');
  v_res     jsonb;
  v_uid     uuid := gen_random_uuid();
  v_staff   uuid := gen_random_uuid();
  v_rogue   uuid := gen_random_uuid();
  v_user    app_users;
  v_err     text;
  v_admin   text := current_setting('request.jwt.claims', true);
  i         integer;
begin
  -- John's login, created the way Supabase Auth's admin API really does it:
  -- the row first, with only the provider in its app metadata, then the
  -- member link written by a second statement. Provisioning must catch the
  -- second step, not just the first.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          lower(v_no) || '@members.bnd-sacco.invalid', '', now(),
          jsonb_build_object('provider', 'email'), '{}'::jsonb, now(), now());
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('member_id', v_john_id)
   where id = v_uid;
  insert into t_ctx values ('john_user', v_uid, null);

  select * into v_user from app_users where id = v_uid;
  insert into t_result (step, ok, detail)
  values ('9a a login created in two steps, as Supabase does it, is linked to exactly one member and on a temporary password',
          v_user.role = 'member' and v_user.is_active and v_user.email is null
          and v_user.password_set_at is null and v_user.must_change_password
          and (select user_id from members where id = v_john_id) = v_uid, null);

  -- A cashier with no email address, who signs in with a phone number.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (v_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'staff-test@staff.bnd-sacco.invalid', '', now(),
          jsonb_build_object('provider', 'email'),
          jsonb_build_object('full_name', 'Test Phone Cashier', 'phone', '0770 000 055'), now(), now());
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', 'cashier')
   where id = v_staff;
  select * into v_user from app_users where id = v_staff;
  insert into t_result (step, ok, detail)
  values ('9b a staff account needs no email: its internal address is not kept and its phone is normalised',
          v_user.role = 'cashier' and v_user.email is null and v_user.phone = '+256770000055', v_user.phone);

  -- ---- One identifier field, the account worked out from it ---------------
  v_res := login_resolve(v_no, 'test-client');
  insert into t_result (step, ok, detail)
  values ('9c a member number resolves to that member''s login',
          not (v_res ->> 'locked')::boolean
          and (v_res -> 'candidates' -> 0 ->> 'user_id')::uuid = v_uid
          and jsonb_array_length(v_res -> 'candidates') = 1, v_res ->> 'key');

  v_res := login_resolve(lower(v_no), 'test-client');
  insert into t_result (step, ok, detail)
  values ('9d typed in lower case it resolves to the same login',
          (v_res -> 'candidates' -> 0 ->> 'user_id')::uuid = v_uid, v_res ->> 'key');

  v_res := login_resolve('0770 000 000', 'test-client');
  insert into t_result (step, ok, detail)
  values ('9e a member''s phone, typed locally, resolves to the same login',
          (v_res -> 'candidates' -> 0 ->> 'user_id')::uuid = v_uid and v_res ->> 'key' = '+256770000000', null);

  v_res := login_resolve('+256770000055', 'test-client');
  insert into t_result (step, ok, detail)
  values ('9f a staff phone resolves to the staff account',
          (v_res -> 'candidates' -> 0 ->> 'user_id')::uuid = v_staff, null);

  v_res := login_resolve('BND99998', 'test-client');
  insert into t_result (step, ok, detail)
  values ('9g an unknown identifier looks just like a known one: not locked, nothing to try',
          not (v_res ->> 'locked')::boolean and jsonb_array_length(v_res -> 'candidates') = 0, v_res::text);

  -- ---- Wrong passwords pause the identifier, known or not -----------------
  for i in 1..5 loop
    perform login_record(v_no, 'test-client-2', v_uid, false, 'invalid');
    perform login_record('BND99998', 'test-client-3', null, false, 'invalid');
  end loop;
  insert into t_result (step, ok, detail)
  values ('9h five wrong passwords pause a real member number',
          (login_resolve(v_no, 'test-client-2') ->> 'locked')::boolean, null);
  insert into t_result (step, ok, detail)
  values ('9i and an unknown one exactly the same way, so pausing reveals nothing',
          (login_resolve('BND99998', 'test-client-3') ->> 'locked')::boolean, null);
  insert into t_result (step, ok, detail)
  values ('9j failures are in the audit log, without any password',
          exists (select 1 from audit_logs where action = 'auth.login_failed' and record_id = v_uid::text)
          -- A field holding a password - "password", "new_password",
          -- "temporary_password" - never "must_change_password", which is a flag.
          and not exists (select 1 from audit_logs
                           where coalesce(new_value::text, '') ~* '"(current_|new_|temp_|temporary_)?password"\s*:'
                              or coalesce(old_value::text, '') ~* '"(current_|new_|temp_|temporary_)?password"\s*:'), null);

  -- ---- A temporary password can do nothing but be changed ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  insert into t_result (step, ok, detail)
  values ('9k on a temporary password the member reads nothing and holds no permission',
          current_member_id() is null and not has_permission('portal.view')
          and (my_session() ->> 'must_change_password')::boolean, null);

  perform log_password_changed();
  insert into t_result (step, ok, detail)
  values ('9l once they choose their own password, their records open up',
          current_member_id() = v_john_id and has_permission('portal.view')
          and not (my_session() ->> 'must_change_password')::boolean
          and (select password_set_at is not null from app_users where id = v_uid), null);
  perform set_config('request.jwt.claims', v_admin, true);

  -- ---- Reset password: a new temporary password, and a forced change -----
  perform issue_temporary_password(v_uid);
  insert into t_result (step, ok, detail)
  values ('9m a staff reset puts the account back on a forced change, and is audited',
          (select must_change_password from app_users where id = v_uid)
          and exists (select 1 from audit_logs where action = 'account.password_reset' and record_id = v_uid::text), null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform log_password_changed();
  perform set_config('request.jwt.claims', v_admin, true);
  insert into t_result (step, ok, detail)
  values ('9n there are no setup codes any more', to_regclass('public.account_setup_codes') is null
          and to_regprocedure('public.setup_code_verify(text, text, text)') is null, null);

  -- Even the database owner, writing SQL by hand, cannot renumber a member or
  -- delete a fee: those rules are triggers, not just missing privileges.
  begin
    update members set member_no = 'BND99999' where id = v_john_id;
    insert into t_result (step, ok, detail) values ('9o a member number can never be changed', false, 'changed');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('9o a member number can never be changed', true, v_err);
  end;

  begin
    delete from fees where id = (select id from t_ctx where key = 'reg_fee');
    insert into t_result (step, ok, detail) values ('9p a fee can never be deleted', false, 'deleted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('9p a fee can never be deleted', true, v_err);
  end;

  -- Somebody signing themselves up through the public API, claiming a role.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (v_rogue, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'rogue.signup@test.invalid', '', now(), '{}'::jsonb,
          jsonb_build_object('role', 'super_admin', 'full_name', 'Rogue'), now(), now());
  select * into v_user from app_users where id = v_rogue;
  insert into t_result (step, ok, detail)
  values ('9q a self sign-up claiming super_admin gets nothing: a switched-off member row',
          v_user.role = 'member' and not v_user.is_active, v_user.role || ' / active=' || v_user.is_active);
end;
$$;

-- ---------------------------------------------------------------------------
-- As John. Nothing he can send changes his record or reads anyone else's.
-- ---------------------------------------------------------------------------
set role authenticated;

do $$
declare
  v_admin   text := current_setting('request.jwt.claims', true);
  v_john_id uuid := (select id from t_ctx where key = 'john');
  v_uid     uuid := (select id from t_ctx where key = 'john_user');
  v_err     text;
  v_n       integer;
  v_session jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  v_session := my_session();
  insert into t_result (step, ok, detail)
  values ('10a John''s session is a member session with portal permissions only',
          v_session ->> 'role_kind' = 'member'
          and not exists (select 1 from jsonb_array_elements_text(v_session -> 'permissions') p
                           where p not like 'portal.%'), v_session -> 'permissions' #>> '{}');

  select count(*) into v_n from members;
  insert into t_result (step, ok, detail)
  values ('10b John reads exactly one member record: his own', v_n = 1, v_n || ' row(s)');

  begin
    update members set full_name = 'Hacked Name', phone = '+256799999999' where id = v_john_id;
    get diagnostics v_n = row_count;
    insert into t_result (step, ok, detail) values ('10c a direct update of his record is refused', v_n = 0, v_n || ' row(s) changed');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('10c a direct update of his record is refused', true, v_err);
  end;

  begin
    perform update_member_profile(v_john_id, jsonb_build_object('full_name', 'Hacked Name'), 'I want to');
    insert into t_result (step, ok, detail) values ('10d the edit function refuses him', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('10d the edit function refuses him', true, v_err);
  end;

  begin
    perform register_member(jsonb_build_object('full_name', 'Fake Member', 'phone', '0700000055'));
    insert into t_result (step, ok, detail) values ('10e he cannot register members', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('10e he cannot register members', true, v_err);
  end;

  begin
    perform post_transaction(v_john_id, 'deposit', 1000000, 'cash', current_date, 'free money', null);
    insert into t_result (step, ok, detail) values ('10f he cannot post to the ledger directly', false, 'posted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('10f he cannot post to the ledger directly', true, v_err);
  end;

  begin
    perform write_audit('member.hacked', 'Members', v_john_id::text, 'forged', null, null, null);
    insert into t_result (step, ok, detail) values ('10g he cannot write to the audit log', false, 'written');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('10g he cannot write to the audit log', true, v_err);
  end;

  begin
    perform set_role_permissions('member', array['portal.loan_apply'], 'self-service');
    insert into t_result (step, ok, detail) values ('10h he cannot change permissions', false, 'changed');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('10h he cannot change permissions', true, v_err);
  end;

  select count(*) into v_n from member_fees;
  insert into t_result (step, ok, detail)
  values ('10i he sees his own fees and nobody else''s',
          v_n = 2 and not exists (select 1 from member_fees where member_id <> v_john_id), v_n || ' row(s)');

  select count(*) into v_n from fee_payment_lines;
  insert into t_result (step, ok, detail) values ('10j he can read the lines of his own receipt', v_n = 2, v_n || ' line(s)');

  select count(*) into v_n from member_profile_changes;
  insert into t_result (step, ok, detail) values ('10k the staff change history is not his to read', v_n = 0, v_n || ' row(s)');

  select count(*) into v_n from audit_logs;
  insert into t_result (step, ok, detail) values ('10l he cannot read the audit log', v_n = 0, v_n || ' row(s)');

  begin
    perform issue_temporary_password(v_uid);
    insert into t_result (step, ok, detail) values ('10m he cannot issue himself a temporary password', false, 'issued');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('10m he cannot issue himself a temporary password', true, v_err);
  end;

  -- Suspended: his existing session reads nothing.
  perform set_config('request.jwt.claims', v_admin, true);
  perform set_member_status(v_john_id, 'suspended', 'members test: suspension');
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  select count(*) into v_n from members;
  insert into t_result (step, ok, detail)
  values ('10n once suspended, even an existing session reads none of his records',
          v_n = 0 and current_member_id() is null, v_n || ' row(s)');

  perform set_config('request.jwt.claims', v_admin, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The REST surface: nothing internal is reachable by a signed-in or
-- signed-out caller.
-- ---------------------------------------------------------------------------
reset role;

insert into t_result (step, ok, detail)
select '11a no internal helper is executable by anon or authenticated',
       count(*) = 0, coalesce(string_agg(p.proname, ', '), 'none')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('post_transaction', 'post_account_entry', 'write_audit', 'next_document_no',
                     'post_fee_payment', 'maybe_activate_member', 'ensure_savings_period',
                     'settle_manual_payment', 'define_setting', 'login_resolve', 'login_record',
                     'login_candidates', 'write_account_audit',
                     'resolve_posting_account', 'account_balance_at', 'run_daily_maintenance')
   and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'));

insert into t_result (step, ok, detail)
select '11b a signed-out caller can execute nothing but the public brand',
       count(*) = 0, coalesce(string_agg(p.proname, ', '), 'none')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname <> 'sacco_public_brand'
   and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                     and d.objid = p.oid and d.deptype = 'e')
   and has_function_privilege('anon', p.oid, 'execute');

insert into t_result (step, ok, detail)
select '11c a signed-in caller cannot write to members, app_users, roles or fees directly',
       not (has_table_privilege('authenticated', 'members', 'update')
            or has_table_privilege('authenticated', 'members', 'insert')
            or has_table_privilege('authenticated', 'app_users', 'update')
            or has_table_privilege('authenticated', 'roles', 'update')
            or has_table_privilege('authenticated', 'role_permissions', 'insert')
            or has_table_privilege('authenticated', 'fees', 'update')
            or has_table_privilege('authenticated', 'member_fees', 'update')
            or has_table_privilege('authenticated', 'transactions', 'insert')), null;

select n, step, case when ok then 'PASS' else 'FAIL' end as result, detail
  from t_result order by n;

rollback;
