/** Source-level release invariants. These do not simulate real authentication
 * or replace isolated Supabase/RLS integration testing. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

function loadModule(path) {
  const file = resolve(path);
  const source = readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const nativeRequire = createRequire(file);
  const require = specifier => {
    const local = resolve(dirname(file),`${specifier}.ts`);
    return specifier.startsWith('.') && existsSync(local) ? loadModule(local) : nativeRequire(specifier);
  };
  const module = { exports: {} };
  new Function('require','module','exports',js)(require,module,module.exports);
  return module.exports;
}
const { landingPath, can, visibleNav, STAFF_NAV, DASHBOARDS } = await loadModule('src/lib/rbac.ts');
const money = await loadModule('src/lib/money.ts');
const format = await loadModule('src/lib/format.ts');
async function files(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(`${root}/${e.name}`) : [`${root}/${e.name}`]))).flat();
}

test('seeded dashboard assignments and landing paths remain consistent', async () => {
  const migration = await readFile('supabase/migrations/0032_unified_login.sql', 'utf8');
  const expected = {
    super_admin: ['administration','/staff/admin'], admin: ['administration','/staff/admin'],
    manager: ['overview','/staff'], cashier: ['cashier','/staff/desk'],
    loan_officer: ['loans','/staff/loans-desk'], accountant: ['finance','/staff/finance'],
    field_officer: ['collections','/staff/savings/collect'], member: ['portal','/'],
  };
  for (const [role,[dashboard,path]] of Object.entries(expected)) {
    assert.match(migration,new RegExp(`when '${role}'\\s+then '${dashboard}'`));
    assert.equal(landingPath({ role, dashboard, roleKind: role==='member'?'member':'staff', permissions:['dashboard.staff','loans.view','finance.view','savings.view'] }),path);
  }
  assert.equal(landingPath({role:'viewer',roleKind:'staff',dashboard:'overview',permissions:['dashboard.staff']}),'/staff');
});

test('custom Owner, Secretary and Treasurer assignments use the existing dashboard mapping', () => {
  for(const role of ['owner','secretary','treasurer']) for(const d of DASHBOARDS) {
    const access={role,roleKind:'staff',dashboard:d.id,permissions:['dashboard.staff',...(d.needs?[d.needs]:[])]};
    assert.equal(landingPath(access),d.href);
    if(d.needs) assert.equal(landingPath({...access,permissions:['dashboard.staff']}),'/staff');
  }
  assert.equal(landingPath(null),'/login');
  assert.equal(landingPath({role:'custom',roleKind:'staff',dashboard:'missing',permissions:[]}),'/staff');
  assert.equal(landingPath({role:'member',roleKind:'member',dashboard:'finance',permissions:['finance.view']}),'/');
});

test('navigation follows explicit permissions, never a display name or role-key shortcut', () => {
  for(const role of ['super_admin','admin','manager','owner','secretary','treasurer','cashier','loan_officer','field_officer','member']) {
    const access={role,roleKind:role==='member'?'member':'staff',permissions:[]};
    assert.equal(can(access,'finance.view'),false);
    assert.equal(visibleNav(access,STAFF_NAV).length,0);
    const allowed=visibleNav({...access,permissions:['dashboard.staff','savings.view']},STAFF_NAV);
    assert.deepEqual(allowed.map(n=>n.href),['/staff','/staff/savings']);
  }
});

test('UGX display keeps complete numeric values and Uganda date boundaries', () => {
  for(const [input,output] of [[2450000,'UGX 2,450,000'],['100000','UGX 100,000'],[6730000,'UGX 6,730,000'],[0,'UGX 0']]) assert.equal(money.formatUGX(input),output);
  assert.equal(format.toISODate(new Date('2026-10-19T21:00:00Z')),'2026-10-20');
  assert.equal(format.toISODate(new Date('2026-10-19T20:59:59Z')),'2026-10-19');
  assert.equal(format.formatDate('2026-10-20'),'20 Oct 2026');
});

test('every development preview page guards production before reading fixtures', async () => {
  const previews=(await files('src/app/dev')).filter(p=>p.endsWith('/page.tsx'));
  assert.ok(previews.length>=4);
  for(const path of previews) {
    const source=await readFile(path,'utf8');
    const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const page=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword));
    const guard=page?.body?.statements[0];
    assert.ok(guard&&ts.isIfStatement(guard),`${path} starts with a production guard`);
    assert.match(guard.getText(ast),/process\.env\.NODE_ENV === 'production'\) notFound\(\)/);
  }
  for(const path of (await files('src')).filter(p=>/\.[tj]sx?$/.test(p)&&!p.startsWith('src/app/dev/'))) {
    const source=await readFile(path,'utf8');
    assert.doesNotMatch(source,/(?:from\s*|import\s*\()(['"])@\/lib\/fixtures\1/,`${path}: development fixtures stay out of production entry points`);
  }
});
