begin;
create temp table t_result(n serial, step text, ok boolean, detail text);
create temp table phone_ctx(region text, member_id uuid, user_id uuid, raw_phone text, phone text);
grant all on t_result, phone_ctx to authenticated;
grant usage on sequence t_result_n_seq to authenticated;

-- Normalization helpers remain private; the JWT still identifies the real admin.
reset role;
do $$
declare r record; v_result jsonb; v_id uuid; v_raw text;
begin
  for r in select * from (values
    ('0772123456', '+256772123456'), ('(0772) 123-456', '+256772123456'),
    ('772123456', '+256772123456'), ('256772123456', '+256772123456'),
    ('+256 772 123 456', '+256772123456'), ('00256772123456', '+256772123456'),
    ('+1 (416) 555-0123', '+14165550123'), ('+44 20 7946 0958', '+442079460958'),
    ('+254 712 123456', '+254712123456'), ('+7 912 3456789', '+79123456789'),
    ('+256 414 123456', '+256414123456'), (U&'\00A0+1\2003416 555 0123\FEFF', '+14165550123')
  ) x(raw_phone, expected) loop
    insert into t_result(step,ok,detail) values ('normalize ' || r.raw_phone,
      normalize_phone(r.raw_phone)=r.expected and normalize_phone(r.expected)=r.expected,
      normalize_phone(r.raw_phone));
  end loop;
  foreach v_raw in array array[null::text,'','   ','123','4165550123','00442079460958',
    '+999123456789','+1416','+10125550123','+1416555012345678','+4402079460958',
    '+254012345678','+2560712123456','+772123456','++14165550123','+1+4165550123',
    'call 0772123456','+14165550123 ext 9'] loop
    insert into t_result(step,ok,detail) values ('reject invalid phone ' || coalesce(v_raw,'NULL'),
      normalize_phone(v_raw) is null, normalize_phone(v_raw));
  end loop;
  insert into t_result(step,ok) values ('legacy normalizer RPC supports international callers',
    normalize_ug_phone('+1 (416) 555-0123')='+14165550123');
  insert into t_result(step,ok) values ('international display keeps the full plus/country code',
    format_phone('+14165550123')='+14165550123' and format_phone('+3545512345')='+3545512345'
    and format_phone('+256772123456')='0772 123 456');
  insert into t_result(step,ok) values ('the Uganda-only constraint is replaced with E.164',
    exists(select 1 from pg_constraint where conrelid='members'::regclass and conname='members_phone_e164')
    and not exists(select 1 from pg_constraint where conrelid='members'::regclass and conname in ('members_phone_ug','members_phone_format')));

  for r in select * from (values
    ('Uganda','0779900111','+256779900111'), ('Canada','+1 (416) 555-0123','+14165550123'),
    ('UK','+44 20 7946 0958','+442079460958'), ('Kenya','+254 712 123456','+254712123456'),
    ('Saint Helena','+290 51234','+29051234')
  ) x(region,raw_phone,expected) loop
    v_result := register_member(jsonb_build_object('full_name','Phone Test '||r.region,
      'phone',r.raw_phone,'next_of_kin_phone','+1 (416) 555-0199'), p_registration_key=>'phone-test:'||r.region);
    v_id := (v_result->>'member_id')::uuid;
    insert into phone_ctx values(r.region,v_id,null,r.raw_phone,r.expected);
    insert into t_result(step,ok) values (r.region||': registration saves E.164 and the international next of kin',
      (select phone=r.expected and next_of_kin_phone='+14165550199' from members where id=v_id));
    begin
      perform register_member(jsonb_build_object('full_name','Duplicate Phone Test','phone',r.expected));
      insert into t_result(step,ok) values(r.region||': formatted duplicate is rejected',false);
    exception when unique_violation then
      insert into t_result(step,ok) values(r.region||': formatted duplicate is rejected',true);
    end;
  end loop;
  begin
    perform register_member(jsonb_build_object('full_name','Invalid Phone Test','phone','+999123456789'));
    insert into t_result(step,ok) values('registration rejects an invalid calling code',false);
  exception when check_violation then
    insert into t_result(step,ok) values('registration rejects an invalid calling code',true);
  end;
end $$;

-- Real Auth provisioning and resolution are service-role-only operations.
reset role;
do $$
declare r record; v_uid uuid; v_result jsonb; v_canada uuid; v_uk uuid; v_no text;
  v_staff uuid := gen_random_uuid(); v_shared uuid; v_shared_user uuid := gen_random_uuid();
begin
  for r in select c.*,m.member_no from phone_ctx c join members m on m.id=c.member_id loop
    v_uid := gen_random_uuid();
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      lower(r.member_no)||'@members.bnd-sacco.invalid','',now(),jsonb_build_object('member_id',r.member_id),
      jsonb_build_object('full_name','Phone Test '||r.region),now(),now());
    update phone_ctx set user_id=v_uid where member_id=r.member_id;
    v_result := login_resolve(r.raw_phone,'international-phone-test');
    insert into t_result(step,ok) values(r.region||': formatted phone resolves to its Auth login',
      v_result->>'key'=r.phone and jsonb_array_length(v_result->'candidates')=1
      and (v_result->'candidates'->0->>'user_id')::uuid=v_uid);
    insert into t_result(step,ok) values(r.region||': canonical phone and member number still resolve',
      (login_resolve(r.phone,'international-phone-test')->'candidates'->0->>'user_id')::uuid=v_uid
      and (login_resolve(r.member_no,'international-phone-test')->'candidates'->0->>'user_id')::uuid=v_uid
      and (select phone=r.phone from app_users where id=v_uid));
    begin
      perform assert_login_phone_available(r.raw_phone);
      insert into t_result(step,ok) values(r.region||': duplicate login phone is rejected',false);
    exception when unique_violation then
      insert into t_result(step,ok) values(r.region||': duplicate login phone is rejected',true);
    end;
  end loop;
  select member_id into v_canada from phone_ctx where region='Canada';
  select member_id into v_uk from phone_ctx where region='UK';
  select member_no into v_no from members where id=v_canada;
  begin
    perform update_member_profile(v_uk,jsonb_build_object('phone','+1 (416) 555-0123'),'Duplicate phone test');
    insert into t_result(step,ok) values('editing rejects an international duplicate',false);
  exception when unique_violation then
    insert into t_result(step,ok) values('editing rejects an international duplicate',true);
  end;
  perform update_member_profile(v_canada,jsonb_build_object('phone','+1 (416) 555-0125',
    'next_of_kin_phone','+254 712 123499'),'International phone edit test');
  insert into t_result(step,ok) values('editing saves canonical member and account phones without changing the member number',
    (select phone='+14165550125' and next_of_kin_phone='+254712123499' and member_no=v_no
       from members where id=v_canada)
    and (select u.phone='+14165550125' from app_users u join members m on m.user_id=u.id where m.id=v_canada));
  insert into t_result(step,ok) values('the edited international phone signs in and the old phone stops resolving',
    jsonb_array_length(login_resolve('+14165550123','international-phone-test')->'candidates')=0
    and (login_resolve('+1 416 555 0125','international-phone-test')->'candidates'->0->>'user_id')::uuid
      =(select user_id from phone_ctx where region='Canada'));
  begin
    perform update_member_profile(v_canada,jsonb_build_object('phone','+999123456789'),'Invalid phone edit test');
    insert into t_result(step,ok) values('editing rejects an invalid calling code',false);
  exception when check_violation then
    insert into t_result(step,ok) values('editing rejects an invalid calling code',true);
  end;
  begin
    update app_users set phone='+999123456789' where id=(select user_id from phone_ctx where region='Canada');
    insert into t_result(step,ok) values('direct account writes reject invalid international phones',false);
  exception when check_violation then
    insert into t_result(step,ok) values('direct account writes reject invalid international phones',true);
  end;
  insert into t_result(step,ok) values('invalid login identifiers have no candidates',
    jsonb_array_length(login_resolve('+999123456789','international-phone-test')->'candidates')=0
    and jsonb_array_length(login_resolve('+772123456','international-phone-test')->'candidates')=0);
  perform login_record('+1 (416) 555-0125','international-phone-test',null,false,'invalid');
  insert into t_result(step,ok) values('international formatting shares one canonical login-attempt key',
    exists(select 1 from login_attempts where client='international-phone-test' and identifier='+14165550125')
    and login_identifier_key('+1 (416) 555-0125')=login_identifier_key('+14165550125'));

  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_staff,'international-phone-staff@staff.bnd-sacco.invalid',jsonb_build_object('role','cashier'),
    jsonb_build_object('full_name','International Phone Cashier','phone','+254 712 123498'));
  insert into t_result(step,ok) values('Auth metadata provisioning normalizes international account phones',
    (select phone='+254712123498' from app_users where id=v_staff)
    and (login_resolve('+254 712 123498','international-phone-test')->'candidates'->0->>'user_id')::uuid=v_staff);
  perform set_user_phone(v_staff,'+1 (416) 555-0198','International staff phone test');
  insert into t_result(step,ok) values('the account phone-setting function stores an international number canonically',
    (select phone='+14165550198' from app_users where id=v_staff));
  begin
    perform set_user_phone(v_staff,'+1 (416) 555-0125','International staff duplicate test');
    insert into t_result(step,ok) values('staff phone changes reject an international member duplicate',false);
  exception when unique_violation then
    insert into t_result(step,ok) values('staff phone changes reject an international member duplicate',true);
  end;
  perform login_record('+1 (416) 555-0198','international-phone-test',v_staff,true);
  insert into t_result(step,ok) values('successful international sign-in is audited as a phone login',
    exists(select 1 from audit_logs where action='auth.login_succeeded' and record_id=v_staff::text
      and summary like '%Signed in with phone number%'));

  v_result := register_member(jsonb_build_object('full_name','Shared International Phone','phone','+44 20 7946 0958'),
    p_allow_shared_phone=>true,p_override_reason=>'Authorised shared international phone test');
  v_shared := (v_result->>'member_id')::uuid;
  select member_no into v_no from members where id=v_shared;
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_shared_user,lower(v_no)||'@members.bnd-sacco.invalid',jsonb_build_object('member_id',v_shared),
    jsonb_build_object('full_name','Shared International Phone'));
  insert into t_result(step,ok) values('the existing authorised shared-phone workflow returns both international login candidates',
    (select allow_shared_phone and phone='+442079460958' from members where id=v_shared)
    and jsonb_array_length(login_resolve('+44 20 7946 0958','international-phone-test')->'candidates')=2);
end $$;
select step,ok,detail from t_result order by n;
rollback;
