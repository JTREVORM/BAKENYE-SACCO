/** Disposable localhost-only certification stack. Never reads .env or hosted
 * credentials. Existing application migrations are applied byte-for-byte. */
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,createHmac} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import pg from 'pg';
export const root=resolve('work/isolated-certification');
const stateFile=`${root}/state.json`;
const prefix='bakenye-cert';
const label='bakenye.certification=disposable';
const dockerEnv={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
export function docker(args,input){
 const r=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env:dockerEnv,input,encoding:'utf8',maxBuffer:8*1024*1024});
 if(r.status!==0)throw new Error(`Local Docker ${args[0]} failed: ${r.stderr.slice(-1800)}`);
 return (args[0]==='logs'?r.stdout+r.stderr:r.stdout).trim();
}
export async function state(){
 const s=JSON.parse(await readFile(stateFile,'utf8'));
 if(s.marker!=='bakenye-disposable-certification-v1'||s.api!=='http://127.0.0.1:54329'||s.app!=='http://localhost:3100'||s.database.database!=='bakenye_certification'||s.database.host!=='127.0.0.1'||s.database.port!==54328)throw new Error('Refusing a non-certification target');
 return s;
}
export async function database(){
 const s=await state();const c=new pg.Client({...s.database,ssl:false,connectionTimeoutMillis:1500});await c.connect();
 try{const r=await c.query('select token from certification_control.guard');if(r.rows[0]?.token!==s.token)throw new Error('Disposable database identity does not match');}
 catch(e){await c.end();throw e;}
 return c;
}
export async function appEnv(){const s=await state();return {...process.env,NEXT_PUBLIC_SUPABASE_URL:s.api,NEXT_PUBLIC_SUPABASE_ANON_KEY:s.anon,SUPABASE_SERVICE_ROLE_KEY:s.service,NEXT_PUBLIC_SITE_URL:s.app,PORT:'3100'};}
async function ready(url){for(let i=0;i<60;i++){try{const r=await fetch(url);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw new Error(`Local service not ready: ${url}`);}
const sign=(secret,role)=>{const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const h=b({alg:'HS256',typ:'JWT'}),p=b({role,iss:'supabase-local-certification',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400*30});return `${h}.${p}.${createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;};
async function up(){
 await mkdir(root,{recursive:true,mode:0o700});
 if((await readdir(root)).length)throw new Error('Archive the previous private work/isolated-certification directory before starting a clean run; stale evidence must not be reused');
 for(const name of ['db','auth','rest']){
  const existing=docker(['ps','-a','--filter',`name=^/${prefix}-${name}$`,'--format','{{.Names}}']);
  if(existing)throw new Error('An existing certification container is present; inspect it or run the explicit down command first');
 }
 const secret=randomBytes(40).toString('hex'),password=randomBytes(24).toString('hex');
 const s={marker:'bakenye-disposable-certification-v1',token:randomBytes(24).toString('hex'),api:'http://127.0.0.1:54329',app:'http://localhost:3100',tokenSeconds:process.argv.includes('--short-tokens')?60:3600,secret,anon:sign(secret,'anon'),service:sign(secret,'service_role'),database:{host:'127.0.0.1',port:54328,database:'bakenye_certification',user:'postgres',password}};
 await writeFile(stateFile,JSON.stringify(s,null,2),{mode:0o600});
 if(!docker(['network','ls','--filter',`name=^${prefix}-local$`,'--format','{{.Name}}']))docker(['network','create','--label',label,`${prefix}-local`]);
 else if(docker(['network','inspect','--format','{{index .Labels "bakenye.certification"}}',`${prefix}-local`])!=='disposable')throw new Error('Refusing an unlabelled existing network');
 docker(['run','-d','--name',`${prefix}-db`,'--label',label,'--network',`${prefix}-local`,'-p','127.0.0.1:54328:5432','-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=bakenye_certification','--tmpfs','/var/lib/postgresql/data:rw','postgres:16']);
 let c;
 for(let i=0;i<60;i++){try{c=new pg.Client({...s.database,ssl:false,connectionTimeoutMillis:1500});await c.connect();break;}catch{await c?.end().catch(()=>{});c=null;await new Promise(r=>setTimeout(r,500));}}
 if(!c)throw new Error('Disposable database did not start');
 await c.query(`create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
 create role anon nologin noinherit; create role authenticated nologin noinherit;
 create role service_role nologin noinherit bypassrls;
 create role authenticator login noinherit password '${password}';
 create role supabase_auth_admin login noinherit password '${password}';
 grant anon,authenticated,service_role to authenticator;
 create schema auth authorization supabase_auth_admin;
 alter role supabase_auth_admin set search_path = auth, public;
 grant usage on schema public to anon,authenticated,service_role;
 create schema certification_control; create table certification_control.guard(token text not null);`);
 await c.query('insert into certification_control.guard values($1)',[s.token]);
 await c.end();
 const authEnv={GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:s.api,GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:`postgres://supabase_auth_admin:${password}@${prefix}-db:5432/bakenye_certification`,GOTRUE_SITE_URL:s.app,GOTRUE_URI_ALLOW_LIST:`${s.app}/**`,GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_EXP:String(s.tokenSeconds),GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED:'true',GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL:'10',GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'true',GOTRUE_EXTERNAL_PHONE_ENABLED:'false',GOTRUE_SESSIONS_TIMEBOX:'24h'};
 await writeFile(`${root}/auth.env`,Object.entries(authEnv).map(([k,v])=>`${k}=${v}`).join('\n'),{mode:0o600});
 docker(['run','-d','--name',`${prefix}-auth`,'--label',label,'--network',`${prefix}-local`,'-p','127.0.0.1:54327:9999','--env-file',`${root}/auth.env`,'supabase/gotrue:v2.197.0']);
 try{await ready('http://127.0.0.1:54327/health');}catch(e){console.error(docker(['logs','--tail','12',`${prefix}-auth`]).replaceAll(password,'[local password]'));throw e;}
 c=await database();
 await c.query(`grant usage on schema auth to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
 alter default privileges in schema public grant all on functions to anon,authenticated,service_role;`);
 const storage=(await readFile('documentation/source/test-stack/01_storage.sql','utf8')).split('-- ---------------------------------------------------------------------------')[0];
 await c.query(storage);
 const migrations=(await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
 for(const name of migrations){await c.query(await readFile(`supabase/migrations/${name}`,'utf8'));console.log(`PASS clean migration ${name}`);}
 // Keep each migration's explicit RPC revocations. Platform defaults above
 // already grant service access on creation; a blanket re-grant here would
 // undo security migrations (including retirement of log_password_changed).
 await c.query('grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role');
 await c.end();
 await writeFile(`${root}/rest.env`,`PGRST_DB_URI=postgres://authenticator:${password}@${prefix}-db:5432/bakenye_certification\nPGRST_DB_SCHEMAS=public\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=${secret}\nPGRST_SERVER_PORT=3000\n`,{mode:0o600});
 docker(['run','-d','--name',`${prefix}-rest`,'--label',label,'--network',`${prefix}-local`,'-p','127.0.0.1:54326:3000','--env-file',`${root}/rest.env`,'postgrest/postgrest:v13.0.7']);
 console.log(`PASS real Supabase Auth + PostgREST + PostgreSQL; ${migrations.length} unchanged application migrations; local credentials saved privately under work/`);
}
async function main(){
 const action=process.argv[2];
 if(action==='up')return up();
 if(action==='auth-tokens'){
  const seconds={short:60,standard:3600}[process.argv[3]];
  if(!seconds)throw new Error('Use auth-tokens short or standard');
  const s=await state(),c=await database();await c.end();
  if(docker(['inspect','--format','{{index .Config.Labels "bakenye.certification"}}',`${prefix}-auth`])!=='disposable')throw new Error('Refusing an unlabelled Auth container');
  let env=await readFile(`${root}/auth.env`,'utf8');
  env=env.replace(/^GOTRUE_JWT_EXP=.*$/m,`GOTRUE_JWT_EXP=${seconds}`).replace(/^GOTRUE_SECURITY_REFRESH_TOKEN_(ROTATION_ENABLED|REUSE_INTERVAL)=.*\n?/gm,'');
  await writeFile(`${root}/auth.env`,`${env}\nGOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true\nGOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL=10\n`,{mode:0o600});
  docker(['rm','-f',`${prefix}-auth`]);
  docker(['run','-d','--name',`${prefix}-auth`,'--label',label,'--network',`${prefix}-local`,'-p','127.0.0.1:54327:9999','--env-file',`${root}/auth.env`,'supabase/gotrue:v2.197.0']);
  await ready('http://127.0.0.1:54327/health');s.tokenSeconds=seconds;await writeFile(stateFile,JSON.stringify(s,null,2),{mode:0o600});
  console.log(`PASS disposable Auth: ${seconds}s JWT, rotation enabled, Supabase-documented 10s refresh reuse interval`);return;
 }
 if(action==='down'){
  for(const name of ['auth','rest','db'])if(docker(['ps','-a','--filter',`label=${label}`,'--filter',`name=^/${prefix}-${name}$`,'--format','{{.Names}}']))docker(['rm','-f',`${prefix}-${name}`]);
  if(docker(['network','ls','--filter',`label=${label}`,'--format','{{.Name}}']).split('\n').includes(`${prefix}-local`))docker(['network','rm',`${prefix}-local`]);
  return;
 }
 if(action==='app'){
  if(!['dev','build','start'].includes(process.argv[4])||process.argv[3]!=='run')throw new Error('Only app run dev, build or start is supported');
  const c=await database();await c.end();
  const child=spawn('npm',process.argv.slice(3).length?process.argv.slice(3):['run','dev','--','-p','3100'],{env:await appEnv(),stdio:'inherit'});
  child.on('exit',code=>{process.exitCode=code??1;});return;
 }
 throw new Error('Use up [--short-tokens], auth-tokens short|standard, down, or app run dev|build|start');
}
if(process.argv[1]===new URL(import.meta.url).pathname)main().catch(e=>{console.error(e.message);process.exit(1);});
