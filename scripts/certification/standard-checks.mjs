/** Stop the local app first: a production build replaces its .next artifacts. */
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {database,appEnv,root} from './local-stack.mjs';
const db=await database();await db.end();
const env=await appEnv(),results=[];let log='';
const checks=[
 ['Lint','npm',['run','lint','--','--ignore-pattern','work/**']],
 ['TypeScript','npm',['run','typecheck']],
 ['Production build','npm',['run','build']],
 ['Dashboard invariants',process.execPath,['scripts/dashboard-certification.test.mjs']],
 ['Fixture arithmetic',process.execPath,['scripts/dashboard-fixtures.test.mjs']],
 ['Phone validation',process.execPath,['scripts/phone.test.mjs']],
 ['Target safety guard',process.execPath,['--test','scripts/certification/safety.test.mjs']],
 ['Compiled production previews',process.execPath,['scripts/dashboard-production-check.mjs']],
];
for(const[name,cmd,args]of checks){
 const r=spawnSync(cmd,args,{env:name==='Compiled production previews'?{...env,NODE_ENV:'production'}:env,encoding:'utf8',maxBuffer:12*1024*1024});
 results.push({name,pass:r.status===0,exitCode:r.status});log+=`\n## ${name}\n${r.stdout??''}${r.stderr??''}`;console.log(`${r.status===0?'PASS':'FAIL'} ${name}`);
 await writeFile(`${root}/standards-console.log`,log);await writeFile(`${root}/standards-results.json`,JSON.stringify({date:new Date().toISOString(),results},null,2));
}
process.exitCode=results.some(r=>!r.pass)?1:0;
