import {createClient} from '@supabase/supabase-js';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {state,database,root} from './local-stack.mjs';
const s=await state();const db=await database();
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(s.api,s.service,options);
const check=(r,label)=>{if(r.error)throw new Error(`${label}: ${r.error.message}`);return r.data;};
const users={};
async function account(key,role,memberId=null,temporary=false){
 let password=`Cert!${randomBytes(12).toString('hex')}9a`;const email=`cert.${key}@certification.test`;
 const meta=memberId?{member_id:memberId}:{role};
 const data=check(await service.auth.admin.createUser({email,password,email_confirm:true,app_metadata:meta,user_metadata:{full_name:`Certification ${key}`}}),'create local account');
 const client=createClient(s.api,s.anon,options);
 check(await client.auth.signInWithPassword({email,password}),'native password sign-in');
 if(!temporary){
  const nonce=check(await service.rpc('begin_password_change',{p_user_id:data.user.id}),'begin verified password change');
  password=`Chosen!${randomBytes(12).toString('hex')}7z`;
  check(await client.auth.updateUser({password}),'choose native Auth password');
  check(await service.rpc('complete_password_change',{p_user_id:data.user.id,p_nonce:nonce}),'complete verified password change');
 }
 users[key]={id:data.user.id,email,password,role,memberId};
 return client;
}
try{
 const admin=await account('super_admin','super_admin');
 for(const role of ['admin','manager','loan_officer','cashier','accountant','field_officer','viewer'])await account(role,role);
 await account('temporary','cashier',null,true);
 const cash=(await db.query("select id from financial_accounts where account_type='cash' and is_default limit 1")).rows[0].id;
 for(const [i,key]of ['member_a','member_b'].entries()){
  const result=check(await admin.rpc('register_member',{p_member:{full_name:`Certification Member ${i?'Beta':'Alpha'}`,phone:`+25677999000${i+1}`}}),'register synthetic member');
  const id=result.member_id;
  const charges=(await db.query("select id from member_fees where member_id=$1 and status='unpaid'",[id])).rows.map(r=>r.id);
  check(await admin.rpc('pay_member_fees',{p_member_id:id,p_charge_ids:charges,p_account_id:cash,p_method:'cash'}),'pay synthetic registration fee');
  await account(key,'member',id);
  users[key].memberNo=(await db.query('select member_no from members where id=$1',[id])).rows[0].member_no;
  for(const [type,amount]of [['savings',i?73500:40000],['shares',i?20000:100000]])check(await admin.rpc('record_member_collection',{p_member_id:id,p_collection_type:type,p_amount:amount,p_account_id:cash,p_method:'cash',p_idempotency_key:`cert:seed:${key}:${type}`}),'synthetic opening activity');
 }
 await account('inactive','viewer');
 await db.query('update app_users set is_active=false where id=$1',[users.inactive.id]);
 await writeFile(`${root}/accounts.json`,JSON.stringify(users,null,2),{mode:0o600});
 console.log(`PASS ${Object.keys(users).length} disposable native Auth accounts; eight existing staff roles, two members, temporary and inactive cases`);
 console.log('PASS registration fees, savings and shares posted through unchanged production RPCs');
}finally{await db.end();}
