/** Run after npm run build:
 * NODE_ENV=production node scripts/dashboard-production-check.mjs
 * Calls the actual compiled preview page functions, without an auth session
 * or database, to verify their independent production 404 guards. */
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
assert.equal(process.env.NODE_ENV,'production');
const require=createRequire(import.meta.url);
async function files(root){
  return(await Promise.all((await readdir(root,{withFileTypes:true})).map(e=>e.isDirectory()?files(`${root}/${e.name}`):[`${root}/${e.name}`]))).flat();
}
function pageLoader(tree){
  if(tree[2]?.page)return tree[2].page[0];
  for(const child of Object.values(tree[1]??{})){const loader=pageLoader(child);if(loader)return loader;}
}
const previews=(await files('.next/server/app/dev')).filter(p=>p.endsWith('/page.js'));
assert.ok(previews.length>=5);
for(const path of previews){
  const bundle=require(resolve(path));
  const loader=pageLoader(bundle.tree??bundle.routeModule?.userland?.loaderTree);
  assert.ok(loader,`Compiled page loader ${path}`);
  const page=await loader();
  const fetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('Production preview guard attempted a data request');};
  try{
    await assert.rejects(async()=>await page.default({params:Promise.resolve({dashboard:'finance'}),searchParams:Promise.resolve({})}),e=>e.digest==='NEXT_HTTP_ERROR_FALLBACK;404');
  }finally{globalThis.fetch=fetch;}
  console.log(`PASS compiled production 404 before data access: ${path}`);
}
for(const path of (await files('.next/static')).filter(p=>p.endsWith('.js')||p.endsWith('.map'))){
  const body=await readFile(path,'utf8');
  for(const sample of ['christine.n@example.com','SAV260830004','MP2609.4471','Nakabugo Christine Ssemakula'])assert.ok(!body.includes(sample),`Development fixture marker found in public asset ${path}`);
}
console.log('PASS public client bundles contain none of the checked development fixture markers');
if(process.argv[2]){
  const base=new URL(process.argv[2]);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'HTTP production smoke tests target a local build only');
  for(const path of ['/','/staff','/staff/admin','/staff/desk','/staff/loans-desk','/staff/finance','/staff/savings/collect','/savings','/shares','/loans','/transactions','/statements','/reports','/notifications','/profile','/dev/preview','/dev/preview/dashboard','/dev/preview/member','/dev/preview/certification','/dev/preview/staff/finance']){
    for(const headers of [{},{RSC:'1'}]){
      const response=await fetch(new URL(path,base),{redirect:'manual',headers});
      assert.equal(response.status,307);
      assert.equal(new URL(response.headers.get('location'),base).pathname,'/login');
      assert.ok(!(await response.text()).includes('SAV260830004'));
    }
    console.log(`PASS local production HTML/RSC signed-out guard ${path}`);
  }
}
