/** Existing fixture regression suites, restricted to our disposable local app. */
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {state,database,appEnv,root} from './local-stack.mjs';
const s=await state(),db=await database();await db.end();
const env={...await appEnv(),CHROMIUM_PATH:process.env.CHROMIUM_PATH||'/usr/bin/chromium'},results=[];
for(const[name,script]of [['Keyboard, menus, branding, shared styles and states','dashboard-accessibility-check.mjs'],['Staff preview responsive regression','staff-dashboards-check.mjs'],['Member preview responsive regression','member-dashboard-check.mjs']]){
 const r=spawnSync(process.execPath,[`scripts/${script}`,s.app],{env,encoding:'utf8',maxBuffer:8*1024*1024});
 const output=`${r.stdout??''}${r.stderr??''}`;
 results.push({name,pass:r.status===0,exitCode:r.status,groups:(output.match(/^PASS /gm)||[]).length,output});
 console.log(`${r.status===0?'PASS':'FAIL'} ${name}`);
 if(r.status!==0)console.log(output.slice(-2000));
 await writeFile(`${root}/preview-results.json`,JSON.stringify({date:new Date().toISOString(),results},null,2));
}
process.exitCode=results.some(r=>!r.pass)?1:0;
