/** Only invokes the legacy SQL runner after verifying our disposable marker.
 * No .env-provided DATABASE_URL can be used. */
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {state,database,root,appEnv} from './local-stack.mjs';
const s=await state();const db=await database();await db.end();
const url=new URL('postgresql://127.0.0.1:54328/bakenye_certification');url.username=s.database.user;url.password=s.database.password;
const log=createWriteStream(`${root}/database-suites.log`);
const child=spawn(process.execPath,['scripts/test-db.mjs'],{env:{...await appEnv(),DATABASE_URL:url.href,PGSSLMODE:'disable'}});
for(const stream of[child.stdout,child.stderr])stream.on('data',d=>{log.write(d);for(const line of d.toString().split('\n'))if(/──|failed|errored|✖/.test(line))console.log(line);});
child.on('exit',code=>{log.end();process.exitCode=code??1;});
