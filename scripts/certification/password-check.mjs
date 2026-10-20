/** BKC-01: real native Auth changes, privileged proofs and client bypass denial.
 * Every write is guarded by the disposable database identity, never .env. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database(),fixtures=JSON.parse(await readFile(`${root}/accounts.json`,'utf8'));
const options={auth:{persistSession:false,autoRefreshToken:false}},make=()=>createClient(s.api,s.anon,options),server=createClient(s.api,s.service,options);
const results=[],secrets=[],value=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
const password=()=>{const p=`Security!${randomBytes(18).toString('hex')}7z`;secrets.push(p);return p;};
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log(`PASS ${name}`);}catch(e){results.push({name,pass:false,detail:e.message});console.log(`FAIL ${name}: ${e.message}`);}}
const admin=make();value(await admin.auth.signInWithPassword({email:fixtures.super_admin.email,password:fixtures.super_admin.password}));
async function account(key,meta){
 const email=`cert.security.${key}@certification.test`,initial=password();
 const user=value(await server.auth.admin.createUser({email,password:initial,email_confirm:true,app_metadata:meta,user_metadata:{full_name:`Certification Security ${key}`}})).user;
 const client=make();value(await client.auth.signInWithPassword({email,password:initial}));return {id:user.id,email,password:initial,client};
}
const staff=await account('cashier',{role:'cashier'});
const begin=u=>server.rpc('begin_password_change',{p_user_id:u.id});
const complete=(u,nonce)=>server.rpc('complete_password_change',{p_user_id:u.id,p_nonce:nonce});
const locked=async u=>{assert.equal(value(await u.client.rpc('my_session')).must_change_password,true);assert.equal(value(await u.client.rpc('has_permission',{p_key:u.memberId?'portal.view':'dashboard.staff'})),false);};
async function changed(u){const next=password();value(await u.client.auth.updateUser({password:next}));const old=u.password;u.password=next;return old;}
async function oldRejected(u,old){assert.ok((await make().auth.signInWithPassword({email:u.email,password:old})).error);const fresh=make();value(await fresh.auth.signInWithPassword({email:u.email,password:u.password}));value(await fresh.auth.refreshSession());return fresh;}
try{
 await test('password RPC grants, definer search paths and proof-table isolation',async()=>{
  for(const name of ['log_password_changed()','begin_password_change(uuid)','complete_password_change(uuid,uuid)']){
   const rows=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') client,has_function_privilege('service_role',$1,'execute') server",[`public.${name}`])).rows[0];
   assert.equal(rows.anon,false);assert.equal(rows.client,false);assert.equal(rows.server,!name.startsWith('log_'));
  }
  const defs=(await db.query("select prosecdef,proconfig from pg_proc where oid in ('public.begin_password_change(uuid)'::regprocedure,'public.complete_password_change(uuid,uuid)'::regprocedure)")).rows;
  assert.equal(defs.length,2);for(const d of defs){assert.equal(d.prosecdef,true);assert.ok(d.proconfig.includes('search_path=""'));}
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_table_privilege($1,'password_security.change_proofs','select,insert,update,delete') allowed",[role])).rows[0].allowed,false);
 });
 await test('original bypass and direct flag writes denied; permissions stay blocked',async()=>{
  await locked(staff);assert.ok((await staff.client.rpc('log_password_changed')).error);
  const r=await staff.client.from('app_users').update({must_change_password:false}).eq('id',staff.id).select('id');assert.ok(r.error||r.data.length===0);await locked(staff);
 });
 await test('clients cannot begin or complete a known server proof',async()=>{
  const nonce=value(await begin(staff));
  assert.ok((await staff.client.rpc('begin_password_change',{p_user_id:staff.id})).error);
  assert.ok((await staff.client.rpc('complete_password_change',{p_user_id:staff.id,p_nonce:nonce})).error);await locked(staff);
 });
 await test('server cannot complete without an actual Auth password change',async()=>{
  const nonce=value(await begin(staff));assert.ok((await complete(staff,nonce)).error);await locked(staff);
 });
 await test('user metadata changes cannot satisfy password proof or unlock account',async()=>{
  const nonce=value(await begin(staff));value(await staff.client.auth.updateUser({data:{must_change_password:false,password_changed:true,role:'super_admin'}}));
  assert.ok((await complete(staff,nonce)).error);assert.equal(value(await staff.client.rpc('my_session')).role,'cashier');await locked(staff);
 });
 await test('failed native password update leaves account locked',async()=>{
  const nonce=value(await begin(staff));assert.ok((await staff.client.auth.updateUser({password:'a'})).error);assert.ok((await complete(staff,nonce)).error);await locked(staff);
 });
 await test('reusing the unchanged temporary password is rejected by native Auth',async()=>{
  const nonce=value(await begin(staff));assert.ok((await staff.client.auth.updateUser({password:staff.password})).error);assert.ok((await complete(staff,nonce)).error);await locked(staff);
 });
 await test('expired, superseded and wrong-account proofs are rejected',async()=>{
  const obsolete=value(await begin(staff)),nonce=value(await begin(staff));assert.ok((await complete(staff,obsolete)).error);
  assert.ok((await complete({...staff,id:fixtures.temporary.id},nonce)).error);
  assert.ok((await complete(staff,randomUUID())).error);
  await db.query("update password_security.change_proofs set expires_at=clock_timestamp()-interval '1 second' where user_id=$1",[staff.id]);assert.ok((await complete(staff,nonce)).error);await locked(staff);
 });
 await test('verified native change restores only own role, audits once, rejects old password and refreshes',async()=>{
  const nonce=value(await begin(staff)),old=await changed(staff);await locked(staff);
  value(await complete(staff,nonce));assert.equal(value(await staff.client.rpc('has_permission',{p_key:'dashboard.staff'})),true);
  assert.equal(value(await staff.client.rpc('has_permission',{p_key:'users.manage'})),false);
  const audit=(await db.query("select count(*) n from audit_logs where actor_id=$1 and action='auth.password_changed'",[staff.id])).rows[0];assert.equal(audit.n,'1');
  assert.ok((await complete(staff,nonce)).error);assert.equal((await db.query('select count(*) n from password_security.change_proofs where user_id=$1',[staff.id])).rows[0].n,'0');
  staff.client=await oldRejected(staff,old);
 });
 await test('new staff reset invalidates in-flight completion and re-blocks existing tokens',async()=>{
  const nonce=value(await begin(staff));await changed(staff);
  value(await admin.rpc('issue_temporary_password',{p_user_id:staff.id}));
  const temporary=password();value(await server.auth.admin.updateUserById(staff.id,{password:temporary}));staff.password=temporary;
  assert.ok((await complete(staff,nonce)).error);await locked(staff);
  value(await staff.client.auth.signInWithPassword({email:staff.email,password:temporary}));await locked(staff);
  assert.equal(value(await staff.client.from('member_financials').select('*')).length,0);
  const fresh=value(await begin(staff)),old=await changed(staff);await locked(staff);value(await complete(staff,fresh));staff.client=await oldRejected(staff,old);
  assert.equal(value(await staff.client.rpc('has_permission',{p_key:'dashboard.staff'})),true);
 });
 await test('member onboarding stays isolated until verified native password completion',async()=>{
  const registration=value(await admin.rpc('register_member',{p_member:{full_name:'Certification Member Password Lifecycle',phone:'+256779990003'}}));
  const member=await account('member',{member_id:registration.member_id});member.memberId=registration.member_id;await locked(member);
  assert.equal(value(await member.client.rpc('current_member_id')),null);
  const nonce=value(await begin(member)),old=await changed(member);await locked(member);value(await complete(member,nonce));
  assert.equal(value(await member.client.rpc('current_member_id')),member.memberId);
  assert.equal(value(await member.client.from('member_financials').select('id').eq('id',fixtures.member_a.memberId)).length,0);
  assert.equal(value(await member.client.rpc('has_permission',{p_key:'dashboard.staff'})),false);await oldRejected(member,old);
 });
 await test('native recovery session can change password using the same verified completion',async()=>{
  const link=value(await server.auth.admin.generateLink({type:'recovery',email:staff.email}));
  const recovery=make();value(await recovery.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'recovery'}));
  const nonce=value(await begin(staff)),old=staff.password;staff.client=recovery;await changed(staff);value(await complete(staff,nonce));await oldRejected(staff,old);
  assert.equal(value(await recovery.rpc('my_session')).role,'cashier');
 });
 await test('verified password completion does not reactivate a disabled account',async()=>{
  const u={...fixtures.inactive,client:make()};value(await u.client.auth.signInWithPassword({email:u.email,password:u.password}));const nonce=value(await begin(u));await changed(u);value(await complete(u,nonce));
  assert.equal(value(await u.client.rpc('has_permission',{p_key:'dashboard.staff'})),false);
  assert.equal((await db.query('select is_active from app_users where id=$1',[u.id])).rows[0].is_active,false);
  fixtures.inactive.password=u.password;await writeFile(`${root}/accounts.json`,JSON.stringify(fixtures,null,2),{mode:0o600});
 });
 await test('password audits contain neither password, Auth hash nor completion nonce',async()=>{
  const audits=JSON.stringify((await db.query("select summary,new_value,old_value from audit_logs where action='auth.password_changed'")).rows);
  for(const secret of secrets)assert.ok(!audits.includes(secret));
  const hashes=(await db.query('select encrypted_password from auth.users where id=$1',[staff.id])).rows;for(const h of hashes)assert.ok(!audits.includes(h.encrypted_password));
  assert.doesNotMatch(audits,/previous_hash|nonce/);
 });
}finally{
 await db.end();await writeFile(`${root}/password-test-secrets.json`,JSON.stringify(secrets),{mode:0o600});
 await writeFile(`${root}/password-results.json`,JSON.stringify({date:new Date().toISOString(),results},null,2));
}
console.log(`${results.filter(r=>r.pass).length} passed, ${results.filter(r=>!r.pass).length} failed`);process.exitCode=results.some(r=>!r.pass)?1:0;
