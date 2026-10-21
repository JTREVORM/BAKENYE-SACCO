/** Export allowlisted synthetic results only, never cookies/accounts/state. */
import {readFile,writeFile,mkdir,readdir,copyFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database(),users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8'));
const target='docs/certification-evidence';await mkdir(`${target}/screenshots`,{recursive:true});
const passwordSecrets=JSON.parse(await readFile(`${root}/password-test-secrets.json`,'utf8'));
const secrets=[s.secret,s.anon,s.service,s.database.password,s.token,...Object.values(users).map(u=>u.password),...passwordSecrets].filter(Boolean);
function sanitized(text){for(const secret of secrets)text=text.replaceAll(secret,'[REDACTED]');return text;}
try{
 for(const file of ['blocker-investigation.json','api-results.json','password-results.json','notification-results.json','notification-repeat-results.json','notification-recheck-results.json','password-form-results.json','password-form-repeat-results.json','collection-results.json','collection-repeat-results.json','workflow-results.json','metrics-results.json','refresh-results.json','restrictions-results.json','preview-results.json','standards-results.json','standards-console.log','database-suites.log']){
  let text=sanitized(await readFile(`${root}/${file}`,'utf8'));
  if(file.endsWith('.log'))text=text.replace(/\r\n?/g,'\n').replace(/[ \t]+$/gm,'');
  await writeFile(`${target}/${file}`,text);
 }
 const initial=JSON.parse(await readFile(`${root}/browser-results.json`,'utf8'));
 const focused=file=>/^browser-(chart|sessions|logout)/.test(file)?1:0;
 const rechecks=(await Promise.all((await readdir(root)).filter(n=>/^browser-[a-z_-]+-results\.json$/.test(n)).map(async file=>({file,...JSON.parse(await readFile(`${root}/${file}`,'utf8'))})))).sort((a,b)=>focused(a.file)-focused(b.file)||a.date.localeCompare(b.date));
 // Replace generated evidence from the previous certification, rather than
 // leaving old role/session retries beside an unrelated clean database run.
 for(const file of await readdir(target))if(/^browser-[a-z_-]+-results\.json$/.test(file)&&!rechecks.some(r=>r.file===file))await unlink(`${target}/${file}`);
 const final=new Map(initial.results.map(r=>[r.name,r]));
 for(const {file,...recheck} of rechecks){
  for(const r of recheck.results){const previous=final.get(r.name),failure=previous&&(!previous.pass?previous:previous.previousAttempt);final.set(r.name,{...r,...(failure?{previousAttempt:failure}:{} )});}
  await writeFile(`${target}/${file}`,sanitized(JSON.stringify(recheck,null,2)));
 }
 await writeFile(`${target}/browser-results.json`,sanitized(JSON.stringify({date:new Date().toISOString(),rechecks:rechecks.map(r=>r.file),results:[...final.values()]},null,2)));
 const members=(await db.query('select member_no,full_name,savings_balance,shares_owned,share_value,loan_balance,total_equity from member_financials order by member_no')).rows;
 if(members.some(m=>!m.full_name.startsWith('Certification Member ')))throw new Error('Refusing to export non-synthetic members');
 const roles=(await db.query('select key,name,kind,dashboard from roles order by key')).rows;
 const balances=(await db.query('select name,account_type,balance from financial_account_balances order by account_type,name')).rows;
 const migrations=[];for(const path of(await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort())migrations.push({file:path,sha256:createHash('sha256').update(await readFile(`supabase/migrations/${path}`)).digest('hex')});
 await writeFile(`${target}/synthetic-snapshot.json`,JSON.stringify({capturedAt:new Date().toISOString(),members,roles,balances,migrations},null,2));
 for(const file of await readdir(`${root}/screenshots`))if(/^(?:(super_admin|admin|manager|loan_officer|cashier|accountant|field_officer|viewer|member_a|member_b)-(320|390|1440)|chart-(super_admin|manager)-(320|390|1440)-12)\.jpg$/.test(file))await copyFile(`${root}/screenshots/${file}`,`${target}/screenshots/${file}`);
 console.log('PASS exported allowlisted synthetic evidence; generated credentials remain private and ignored');
}finally{await db.end();}
