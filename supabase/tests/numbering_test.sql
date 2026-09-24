begin;

create temp table t_result (n serial, step text, ok boolean, detail text);

-- ===========================================================================
-- The human-facing numbering scheme (0038).
--
-- Member numbers BND + YY + 001; document references PREFIX + YYMMDD + 001.
-- Checks the shape of both, that each sequence starts again at 001 when its
-- scope rolls over, that a number a member already holds is never handed out
-- again, that concurrent callers cannot be given the same number, and that a
-- real registration, posting, receipt and reversal come out in the new form.
-- Everything is rolled back at the end.
-- ===========================================================================

reset role;

-- ---------------------------------------------------------------------------
-- A super admin to register and post as.
-- ---------------------------------------------------------------------------
do $fixture$
declare
  v_admin uuid := '00000000-0000-4000-8000-00000000ff01';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'numbering.admin@test.invalid', '', now(), jsonb_build_object('role', 'super_admin'),
          jsonb_build_object('full_name', 'Numbering Test Admin'), now(), now());

  update app_users set must_change_password = false where id = v_admin;
end;
$fixture$;

-- ---------------------------------------------------------------------------
-- 1. Member numbers
-- ---------------------------------------------------------------------------
do $$
declare
  v_yy text := to_char(current_date, 'YY');
  v_a  text;
  v_b  text;
  v_c  text;
begin
  delete from doc_counters where scope = 'MEMBER-' || v_yy;

  v_a := next_member_no();
  v_b := next_member_no();
  v_c := next_member_no();

  insert into t_result (step, ok, detail) values
    ('1a a member number is BND + YY + 3 digits',
     v_a ~ ('^BND' || v_yy || '[0-9]{3}$'), v_a);

  insert into t_result (step, ok, detail) values
    ('1b consecutive registrations get consecutive numbers',
     (regexp_replace(v_b, '^BND' || v_yy, ''))::integer
       = (regexp_replace(v_a, '^BND' || v_yy, ''))::integer + 1
     and (regexp_replace(v_c, '^BND' || v_yy, ''))::integer
       = (regexp_replace(v_b, '^BND' || v_yy, ''))::integer + 1,
     v_a || ', ' || v_b || ', ' || v_c);

  insert into t_result (step, ok, detail) values
    ('1c no member number is issued twice',
     v_a <> v_b and v_b <> v_c and v_a <> v_c, v_a || ' / ' || v_b || ' / ' || v_c);

  insert into t_result (step, ok, detail) values
    ('1d the year is the year of registration',
     substr(v_a, 4, 2) = to_char(current_date, 'YY'), substr(v_a, 4, 2));
end;
$$;

-- The counter is scoped to the year, so 1 January meets a year that has never
-- issued a number. Clearing this year's counter puts the database in exactly
-- that state.
--
-- What "starting again" means depends on who is already on the register. On an
-- empty database the next number is 001. Where members are already registered
-- for this year, the generator skips the numbers they hold rather than
-- reissuing one - which is the behaviour 1g below checks directly. So the
-- expectation here is the first number this year that nobody holds, which is
-- 001 on a fresh install and the next free one otherwise.
do $$
declare
  v_yy   text := to_char(current_date, 'YY');
  v_a    text;
  v_next integer;
  v_saved bigint;
begin
  select last_value into v_saved from doc_counters where scope = 'MEMBER-' || v_yy;
  delete from doc_counters where scope = 'MEMBER-' || v_yy;

  select coalesce(min(n), 1) into v_next
    from generate_series(1, (select count(*) + 1 from members
                              where member_no like 'BND' || v_yy || '%')) n
   where not exists (select 1 from members m
                      where m.member_no = 'BND' || v_yy || lpad(n::text, 3, '0'));

  v_a := next_member_no();

  insert into t_result (step, ok, detail) values
    ('1e the sequence starts again at the first free number of the year',
     v_a = 'BND' || v_yy || lpad(v_next::text, 3, '0'),
     format('%s (expected the first free: %s)', v_a,
            'BND' || v_yy || lpad(v_next::text, 3, '0')));

  insert into t_result (step, ok, detail) values
    ('1f every year keeps a counter of its own, so 2027 cannot continue 2026',
     (select count(*) from doc_counters where scope like 'MEMBER-%') = 1
     and (select scope from doc_counters where scope like 'MEMBER-%') = 'MEMBER-' || v_yy,
     (select string_agg(scope || '=' || last_value, ', ')
        from doc_counters where scope like 'MEMBER-%'));

  -- Put the counter back where the register had left it.
  if v_saved is not null then
    update doc_counters set last_value = greatest(last_value, v_saved)
     where scope = 'MEMBER-' || v_yy;
  end if;
end;
$$;

-- A number a member already holds is skipped rather than reissued: the state
-- a restore, or members carried in from the paper register, can leave behind.
do $$
declare
  v_yy text := to_char(current_date, 'YY');
  v_a  text;
begin
  insert into members (member_no, full_name, phone)
  values ('BND' || v_yy || '900', 'Carried In From Paper', '+256779900900');
  update doc_counters set last_value = 899 where scope = 'MEMBER-' || v_yy;

  v_a := next_member_no();

  insert into t_result (step, ok, detail) values
    ('1g a number a member already holds is skipped, never reissued',
     v_a = 'BND' || v_yy || '901', v_a);
end;
$$;

-- Past 999 the number widens rather than wrapping: it stays unique, stays in
-- issue order, and the counter stays open for business.
do $$
declare
  v_yy text := to_char(current_date, 'YY');
  v_a  text;
  v_b  text;
begin
  update doc_counters set last_value = 998 where scope = 'MEMBER-' || v_yy;
  v_a := next_member_no();
  v_b := next_member_no();

  insert into t_result (step, ok, detail) values
    ('1h the 999th member of a year is BND' || v_yy || '999', v_a = 'BND' || v_yy || '999', v_a);

  insert into t_result (step, ok, detail) values
    ('1i the 1000th widens to four digits rather than repeating 001',
     v_b = 'BND' || v_yy || '1000', v_b);

  -- Put the counter back where the rest of the suite expects it.
  update doc_counters set last_value = 901 where scope = 'MEMBER-' || v_yy;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Document references
-- ---------------------------------------------------------------------------
do $$
declare
  v_day text := to_char(current_date, 'YYMMDD');
  v_a   text;
  v_b   text;
  v_saved jsonb;
begin
  -- Start from a day that has issued nothing, whatever the live counters hold,
  -- so the expected numbers below are the ones a fresh morning would produce.
  --
  -- The counters are put back at the end of this block. Documents issued
  -- earlier today are still there, so leaving the counters wound back to zero
  -- would make the next real receipt collide with one that already exists -
  -- which is exactly what happened when this suite was first run against a
  -- database that had seen a day's work.
  select coalesce(jsonb_object_agg(scope, last_value), '{}'::jsonb) into v_saved
    from doc_counters
   where scope in ('SAV-' || v_day, 'RCT-' || v_day, 'LRP-' || v_day, 'SHR-' || v_day);

  delete from doc_counters where scope in ('SAV-' || v_day, 'RCT-' || v_day,
                                           'LRP-' || v_day, 'SHR-' || v_day);

  v_a := next_document_no('SAV');
  v_b := next_document_no('SAV');

  insert into t_result (step, ok, detail) values
    ('2a a reference is PREFIX + YYMMDD + 3 digits',
     v_a ~ ('^SAV' || v_day || '[0-9]{3}$'), v_a);

  insert into t_result (step, ok, detail) values
    ('2b the date in a reference is today', substr(v_a, 4, 6) = v_day, substr(v_a, 4, 6));

  insert into t_result (step, ok, detail) values
    ('2c the daily sequence counts up', v_b = 'SAV' || v_day || '002', v_a || ', ' || v_b);

  insert into t_result (step, ok, detail) values
    ('2d each kind of document counts separately',
     next_document_no('RCT') = 'RCT' || v_day || '001'
     and next_document_no('LRP') = 'LRP' || v_day || '001'
     and next_document_no('SHR') = 'SHR' || v_day || '001',
     null);

  -- Tomorrow morning meets a day that has never issued a reference.
  delete from doc_counters where scope = 'SAV-' || v_day;
  insert into t_result (step, ok, detail) values
    ('2e the sequence starts again at 001 the next day',
     next_document_no('SAV') = 'SAV' || v_day || '001', null);

  update doc_counters set last_value = 999 where scope = 'SAV-' || v_day;
  insert into t_result (step, ok, detail) values
    ('2f past 999 in a day the number widens rather than repeating',
     next_document_no('SAV') = 'SAV' || v_day || '1000', null);

  insert into t_result (step, ok, detail) values
    ('2g a bank withdrawal asked for by its old prefix comes out as WDL',
     next_document_no('WD') ~ ('^WDL' || v_day || '[0-9]{3,}$'), next_document_no('WD'));

  insert into t_result (step, ok, detail) values
    ('2h a member number asked for by its old prefix is a member number',
     next_document_no('M', 7) ~ ('^BND' || to_char(current_date, 'YY') || '[0-9]{3,}$'), null);

  -- Put the counters back where the day's real work had left them, so nothing
  -- issued after this block can collide with a document already on file.
  update doc_counters c
     set last_value = greatest(c.last_value, (v_saved ->> c.scope)::bigint)
   where v_saved ? c.scope;
end;
$$;

do $$
declare
  v_ref text;
begin
  begin
    v_ref := next_document_no('   ');
    insert into t_result (step, ok, detail) values
      ('2i a reference is never issued without a prefix', false, v_ref);
  exception when check_violation then
    insert into t_result (step, ok, detail) values
      ('2i a reference is never issued without a prefix', true, sqlerrm);
  end;
end;
$$;

do $$
begin
  insert into t_result (step, ok, detail) values
    ('2j every kind of money movement carries the agreed prefix',
     txn_reference_prefix('weekly_savings')     = 'SAV'
     and txn_reference_prefix('monthly_savings')   = 'SAV'
     and txn_reference_prefix('share_purchase')    = 'SHR'
     and txn_reference_prefix('loan_repayment')    = 'LRP'
     and txn_reference_prefix('loan_disbursement') = 'LDS'
     and txn_reference_prefix('deposit')           = 'DEP'
     and txn_reference_prefix('withdrawal')        = 'WDL'
     and txn_reference_prefix('income')            = 'INC'
     and txn_reference_prefix('expense')           = 'EXP'
     and txn_reference_prefix('payment')           = 'PAY'
     and txn_reference_prefix('transfer')          = 'TRF'
     and txn_reference_prefix('fee')               = 'FEE'
     and txn_reference_prefix('penalty')           = 'PEN',
     null);

  insert into t_result (step, ok, detail) values
    ('2k no kind of money movement is left without a prefix',
     (select bool_and(txn_reference_prefix(e.enumlabel::txn_type) ~ '^[A-Z]{3}$')
        from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'txn_type'),
     (select string_agg(e.enumlabel || '=' || txn_reference_prefix(e.enumlabel::txn_type), ', '
                        order by e.enumsortorder)
        from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'txn_type'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. A registration, a posting, a receipt and a reversal, end to end
-- ---------------------------------------------------------------------------
do $$
declare
  v_yy    text := to_char(current_date, 'YY');
  v_day   text := to_char(current_date, 'YYMMDD');
  v_admin uuid := '00000000-0000-4000-8000-00000000ff01';
  v_mid   uuid;
  v_no    text;
  v_ref   text;
  v_rev   text;
  v_rct   text;
  v_txn   uuid;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_mid := (register_member(jsonb_build_object(
              'full_name', 'Numbering Test Member', 'phone', '+256779900901',
              'share_category_id',   (select id from share_categories   where status = 'active' order by sort_order limit 1),
              'savings_category_id', (select id from savings_categories where status = 'active' order by sort_order limit 1)))
            ->> 'member_id')::uuid;
  select member_no into v_no from members where id = v_mid;

  insert into t_result (step, ok, detail) values
    ('3a registering a member issues BND + YY + sequence',
     v_no ~ ('^BND' || v_yy || '[0-9]{3,}$'), v_no);

  insert into t_result (step, ok, detail) values
    ('3b every member number in the register is unique',
     (select count(*) = count(distinct member_no) from members), null);

  v_ref := record_cash_movement(v_mid, 'deposit', 25000, 'cash', current_date,
                                'Numbering test deposit') ->> 'reference';

  insert into t_result (step, ok, detail) values
    ('3c a deposit is numbered DEP + YYMMDD + sequence',
     v_ref ~ ('^DEP' || v_day || '[0-9]{3,}$'), v_ref);

  select id into v_txn from transactions where reference = v_ref;
  select receipt_no into v_rct from receipts where transaction_id = v_txn;

  insert into t_result (step, ok, detail) values
    ('3d the receipt issued for it is RCT + YYMMDD + sequence',
     v_rct ~ ('^RCT' || v_day || '[0-9]{3,}$'), v_rct);

  insert into t_result (step, ok, detail) values
    ('3e the printed receipt shows that number, not a UUID',
     (receipt_for_transaction(v_txn) ->> 'receipt_no') = v_rct,
     receipt_for_transaction(v_txn) ->> 'receipt_no');

  insert into t_result (step, ok, detail) values
    ('3f nothing on the printed receipt is a UUID',
     not ((receipt_for_transaction(v_txn) -> 'transaction' ->> 'reference')
            ~ '[0-9a-f]{8}-[0-9a-f]{4}'),
     receipt_for_transaction(v_txn) -> 'transaction' ->> 'reference');

  v_rev := reverse_transaction(v_txn, 'Numbering test reversal') ->> 'reversal_reference';

  insert into t_result (step, ok, detail) values
    ('3g a reversal is its own document, REV + YYMMDD + sequence',
     v_rev ~ ('^REV' || v_day || '[0-9]{3,}$'), v_rev);

  insert into t_result (step, ok, detail) values
    ('3h no two ledger rows share a reference',
     (select count(*) = count(distinct reference) from transactions), null);

  insert into t_result (step, ok, detail) values
    ('3i every ledger reference is in the new form',
     (select bool_and(reference ~ '^[A-Z]{3}[0-9]{6}[0-9]{3,}$') from transactions),
     (select string_agg(distinct reference, ', ') from transactions));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Signing in with a member number in the new form
-- ---------------------------------------------------------------------------
do $$
declare
  v_no text := (select member_no from members where full_name = 'Numbering Test Member');
begin
  insert into t_result (step, ok, detail) values
    ('4a a member number is looked up exactly as issued',
     login_identifier_key(v_no) = v_no, login_identifier_key(v_no));

  insert into t_result (step, ok, detail) values
    ('4b lower case, spaces and a stray dash are forgiven',
     login_identifier_key(lower(v_no)) = v_no
     and login_identifier_key(' ' || left(v_no, 3) || '-' || substr(v_no, 4) || ' ') = v_no,
     login_identifier_key(lower(v_no)));

  insert into t_result (step, ok, detail) values
    ('4c a member number issued under the old scheme still resolves',
     login_identifier_key('bnd-m-123') = 'BND-M-0000123', login_identifier_key('bnd-m-123'));

  insert into t_result (step, ok, detail) values
    ('4d a phone number is still read as a phone number',
     login_identifier_key('0779900901') = '+256779900901', login_identifier_key('0779900901'));

  insert into t_result (step, ok, detail) values
    ('4e an email is still read as an email',
     login_identifier_key('Cashier@Example.COM') = 'cashier@example.com', null);
end;
$$;

select step, ok, detail from t_result order by n;

rollback;
