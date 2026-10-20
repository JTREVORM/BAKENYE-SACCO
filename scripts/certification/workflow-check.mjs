/** Synthetic financial workflows through real authenticated REST/RPCs. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database(),users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8'));
const results=[],clients={},tag=`cert:workflow:${Date.now()}`;
const value=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
async function call(key,fn,args){
 if(!clients[key]){const c=createClient(s.api,s.anon,{auth:{persistSession:false,autoRefreshToken:false}});value(await c.auth.signInWithPassword({email:users[key].email,password:users[key].password}));clients[key]=c;}
 return clients[key].rpc(fn,args);
}
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log(`PASS ${name}`);}catch(e){results.push({name,pass:false,detail:e.message});console.log(`FAIL ${name}: ${e.message}`);}}
const mid=users.member_a.memberId,other=users.member_b.memberId;
const accounts=(await db.query("select id,account_type from financial_accounts order by is_default desc,created_at")).rows;
const cash=accounts.find(a=>a.account_type==='cash').id;
let merchant=accounts.find(a=>a.account_type==='merchant')?.id,bank=accounts.find(a=>a.account_type==='bank')?.id;
const today=(await db.query('select current_date::text d')).rows[0].d;
const total=async()=>Number(value(await call('manager','treasury_summary')).totals.total);
try{
 await test('create synthetic merchant and bank accounts through authorized setup RPC',async()=>{
  if(!merchant)merchant=value(await call('super_admin','create_financial_account',{p_account_type:'merchant',p_name:'Certification Merchant',p_provider:'Synthetic provider',p_merchant_code:'CERT-MERCHANT',p_account_identifier:'CERT-ACCOUNT'})).id;
  if(!bank)bank=value(await call('super_admin','create_financial_account',{p_account_type:'bank',p_name:'Certification Bank',p_bank_name:'Synthetic Bank',p_branch:'Certification',p_account_number:'CERT-BANK-001'})).id;
  assert.ok(merchant);assert.ok(bank);
 });
 await test('native roles: collection, member receipt ownership, transfer approval and conservation',async()=>{
  const collection=value(await call('cashier','record_member_collection',{p_member_id:mid,p_collection_type:'savings',p_amount:52500,p_account_id:merchant,p_external_ref:`${tag}:mobile`,p_idempotency_key:`${tag}:collection`}));
  assert.ok(value(await call('member_a','receipt_for_transaction',{p_transaction_id:collection.transaction_id})));
  assert.ok((await call('member_b','receipt_for_transaction',{p_transaction_id:collection.transaction_id})).error);
  const before=await total();
  const transfer=value(await call('cashier','create_internal_transfer',{p_source_account_id:merchant,p_destination_account_id:bank,p_amount:40000,p_source_reference:`${tag}:withdrawal`,p_destination_reference:`${tag}:deposit`,p_description:'Disposable certification transfer',p_idempotency_key:`${tag}:transfer`}));
  assert.equal(transfer.status,'submitted');assert.equal(await total(),before);
  assert.ok((await call('cashier','decide_internal_transfer',{p_id:transfer.id,p_approve:true})).error);
  const approved=value(await call('manager','decide_internal_transfer',{p_id:transfer.id,p_approve:true}));assert.equal(approved.status,'completed');assert.equal(await total(),before);
  const rows=(await db.query('select sum(debit) debit,sum(credit) credit from account_ledger_entries where transaction_id=(select transaction_id from internal_transfers where id=$1)',[transfer.id])).rows[0];
  assert.equal(Number(rows.debit),40000);assert.equal(Number(rows.credit),40000);
 });
 await test('native roles: whole-share purchase increases authorized holdings by ten',async()=>{
  const before=(await db.query('select shares_owned,share_value from member_financials where id=$1',[other])).rows[0];
  value(await call('cashier','record_member_collection',{p_member_id:other,p_collection_type:'shares',p_amount:100000,p_account_id:cash,p_method:'cash',p_idempotency_key:`${tag}:shares`}));
  const after=(await db.query('select shares_owned,share_value from member_financials where id=$1',[other])).rows[0];
  assert.equal(Number(after.shares_owned)-Number(before.shares_owned),10);assert.equal(Number(after.share_value)-Number(before.share_value),100000);
 });
 await test('native roles: loan application, assessment, approval, disbursement and repayment',async()=>{
  const product=value(await call('super_admin','save_loan_product',{p_product_id:null,p_payload:{name:'Disposable Certification Loan',code:`C${Date.now().toString(36).toUpperCase()}`,interest_rate:12,interest_method:'flat',min_amount:100000,max_amount:1000000,min_period_months:1,max_period_months:12,repayment_frequency:'monthly',processing_fee_pct:0,insurance_fee_pct:0,application_fee:0,late_penalty_pct:0,penalty_basis:'overdue',grace_period_days:0,min_savings_balance:0,min_savings_multiple:0,min_membership_months:0,required_shares:0,requires_guarantors:false,min_guarantors:0,requires_collateral:false,is_active:true,sort_order:999},p_reason:'Disposable isolated certification product'}));
  const applied=value(await call('member_a','apply_for_loan',{p_member_id:mid,p_product_id:product.id,p_principal:100000,p_period_months:6,p_purpose:'Synthetic certification workflow',p_idempotency_key:`${tag}:loan`}));
  assert.ok((await call('member_b','set_loan_status',{p_loan_id:applied.loan_id,p_status:'approved'})).error);
  value(await call('loan_officer','set_loan_status',{p_loan_id:applied.loan_id,p_status:'under_review',p_reason:'Disposable test assessment'}));
  assert.ok((await call('loan_officer','set_loan_status',{p_loan_id:applied.loan_id,p_status:'approved'})).error);
  value(await call('manager','set_loan_status',{p_loan_id:applied.loan_id,p_status:'approved'}));
  const before=await total();value(await call('manager','disburse_loan',{p_loan_id:applied.loan_id,p_method:'cash',p_idempotency_key:`${tag}:disburse`}));assert.equal(await total(),before-100000);
  const due=Number((await db.query('select outstanding from loan_balances where loan_id=$1',[applied.loan_id])).rows[0].outstanding);
  value(await call('cashier','record_loan_repayment',{p_loan_id:applied.loan_id,p_amount:20000,p_paid_on:today,p_method:'cash',p_idempotency_key:`${tag}:repayment`}));
  assert.equal(Number((await db.query('select outstanding from loan_balances where loan_id=$1',[applied.loan_id])).rows[0].outstanding),due-20000);
  assert.equal(value(await call('member_b','current_member_id')),other);
  const hidden=value(await clients.member_b.from('loans').select('id').eq('id',applied.loan_id));assert.equal(hidden.length,0);
 });
 await test('native roles: expense approval, reversal and duplicate reversal refusal',async()=>{
  const category=(await db.query('select id from expense_categories where is_active order by name limit 1')).rows[0].id;
  const before=await total();
  const expense=value(await call('cashier','record_expense',{p_category_id:category,p_amount:2000,p_description:'Disposable certification stationery',p_payment_account_id:cash,p_method:'cash',p_idempotency_key:`${tag}:expense`}));
  assert.equal(await total(),before);assert.ok((await call('cashier','approve_expense',{p_expense_id:expense.expense_id,p_approve:true})).error);
  const approved=value(await call('manager','approve_expense',{p_expense_id:expense.expense_id,p_approve:true,p_reason:'Disposable test approval'}));assert.ok(approved);assert.equal(await total(),before-2000);
  const tx=(await db.query('select transaction_id from expense_entries where id=$1',[expense.expense_id])).rows[0].transaction_id;
  value(await call('manager','reverse_transaction',{p_transaction_id:tx,p_reason:'Disposable certification correction'}));assert.equal(await total(),before);
  assert.ok((await call('manager','reverse_transaction',{p_transaction_id:tx,p_reason:'Duplicate certification reversal'})).error);
 });
 await test('native roles: reconciliation and reports equal underlying ledger',async()=>{
  const balances=(await db.query('select id,balance from financial_account_balances')).rows;
  for(const a of balances){
   const reconciled=value(await call('accountant','record_reconciliation',{p_account_id:a.id,p_reconciliation_date:today,p_actual_balance:Number(a.balance),p_statement_reference:`${tag}:statement`}));assert.equal(Number(reconciled.variance),0);
  }
  const report=value(await call('accountant','cash_bank_report',{p_from:'2026-01-01',p_to:today}));
  for(const a of balances)assert.equal(Number(report.accounts.find(r=>r.id===a.id).closing),Number(a.balance));
  const rp=value(await call('accountant','receipts_and_payments',{p_from:'2026-01-01',p_to:today}));assert.ok(Array.isArray(rp.receipts));assert.ok(Array.isArray(rp.payments));
  const flow=value(await call('accountant','treasury_monthly_flow',{p_months:6}));
  for(const bucket of flow){
   const expected=(await db.query("select coalesce(sum(money_in),0) i,coalesce(sum(money_out),0) o from account_movements where txn_status='posted' and txn_type<>'transfer' and date_trunc('month',entry_date)::date=$1",[bucket.bucket])).rows[0];
   assert.equal(Number(bucket.money_in),Number(expected.i));assert.equal(Number(bucket.money_out),Number(expected.o));
  }
 });
}finally{await db.end();await writeFile(`${root}/workflow-results.json`,JSON.stringify({date:new Date().toISOString(),results},null,2));}
console.log(`${results.filter(r=>r.pass).length} passed, ${results.filter(r=>!r.pass).length} failed`);process.exitCode=results.some(r=>!r.pass)?1:0;
