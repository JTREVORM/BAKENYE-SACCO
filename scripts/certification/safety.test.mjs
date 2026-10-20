import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const moduleUrl=new URL('./local-stack.mjs',import.meta.url).href;
test('mutation tooling refuses hosted or unrelated targets before opening a connection',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'bakenye-cert-guard-'));
 const valid={marker:'bakenye-disposable-certification-v1',api:'http://127.0.0.1:54329',app:'http://localhost:3100',database:{host:'127.0.0.1',port:54328,database:'bakenye_certification'}};
 try{
  await mkdir(join(cwd,'work/isolated-certification'),{recursive:true});
  for(const override of [{api:'https://hosted.example.invalid'},{app:'https://hosted.example.invalid'},{marker:'unrelated'},{database:{...valid.database,host:'hosted.example.invalid'}},{database:{...valid.database,database:'postgres'}},{database:{...valid.database,port:5432}}]){
   await writeFile(join(cwd,'work/isolated-certification/state.json'),JSON.stringify({...valid,...override}));
   const r=spawnSync(process.execPath,['--input-type=module','-e',`import{state}from ${JSON.stringify(moduleUrl)};await state();`],{cwd,encoding:'utf8',env:{PATH:process.env.PATH}});
   assert.notEqual(r.status,0);assert.match(r.stderr,/Refusing a non-certification target/);
  }
 }finally{await rm(cwd,{recursive:true,force:true});}
});
