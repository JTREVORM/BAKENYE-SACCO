/**
 * F-01 / BKC-01 over a real REST API.
 *
 *   node scripts/password-security-rest-check.mjs
 *
 * The SQL suite `supabase/tests/password_security_test.sql` proves the control
 * holds inside the database. This proves it holds at the boundary an attacker
 * actually reaches: PostgREST, with a real bearer token, over HTTP. The two
 * are not the same test - a function can be correct and still be reachable
 * because of a stray grant, and `has_function_privilege()` is a claim about the
 * catalogue rather than an observation of the API refusing.
 *
 * It replays the audit's reproduction step for step and asserts that every one
 * of them now fails:
 *
 *   [1] a member still on a staff-issued temporary password gets a token
 *   [2] my_session()              -> must_change_password = true
 *   [3] GET /rest/v1/transactions -> []                      (the lock holds)
 *   [4] POST /rpc/log_password_changed                        (the attack)
 *   [5] my_session()              -> must_change_password MUST still be true
 *   [6] GET /rest/v1/transactions -> MUST still be []
 *
 * ENVIRONMENT
 *
 *   REST_URL         PostgREST base URL          (default http://127.0.0.1:3001)
 *   REST_JWT_SECRET  the secret PostgREST verifies tokens with
 *   DATABASE_URL     the same database, to provision the synthetic account
 *
 * Every account it touches is created by this script, from synthetic values,
 * and removed again at the end. It must never be pointed at a database holding
 * real member records; it refuses to run unless REST_ALLOW_WRITES is set, so
 * that cannot happen by accident.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const REST = (process.env.REST_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const SECRET = process.env.REST_JWT_SECRET;
const DB = process.env.REST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!SECRET || !DB) {
  console.error('Set REST_JWT_SECRET and DATABASE_URL (or REST_DATABASE_URL).');
  process.exit(1);
}
if (!process.env.REST_ALLOW_WRITES) {
  console.error(
    'This check creates and deletes a synthetic login. Set REST_ALLOW_WRITES=1 to confirm\n' +
      'the database it points at is a disposable one, never the SACCO\'s.',
  );
  process.exit(1);
}

let failures = 0;
const ok = (pass, text) => {
  if (!pass) failures += 1;
  console.log(`${pass ? '✔' : '✖'} ${text}`);
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** An HS256 bearer token, exactly the shape Supabase Auth issues. */
function token(claims) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ iss: 'supabase', iat: 1700000000, exp: 2000000000, ...claims });
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function rest(path, jwt, init = {}) {
  const res = await fetch(`${REST}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const client = new pg.Client({
  connectionString: DB,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});
await client.connect();

const HASH = '$2a$10$RESTCHECKtemporaryPASSWORDhashAAAAAAAAAAAAAAAAAAAAAAA';
let userId = null;

try {
  // ---- [1] a member login on a staff-issued temporary password ------------
  const { rows } = await client.query(
    "select id from members where user_id is null order by member_no limit 1",
  );
  if (rows.length === 0) throw new Error('No seeded member without a login to use.');
  const memberId = rows[0].id;

  const created = await client.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                             email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                             created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
             'authenticated', 'rest-check@members.bnd-sacco.invalid', $1, now(),
             jsonb_build_object('provider','email'), '{}'::jsonb, now(), now())
     returning id`,
    [HASH],
  );
  userId = created.rows[0].id;
  await client.query(
    `update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('member_id', $2::text)
      where id = $1`,
    [userId, memberId],
  );

  const provisioned = await client.query(
    'select must_change_password, is_active, role from app_users where id = $1',
    [userId],
  );
  ok(
    provisioned.rows[0]?.must_change_password === true && provisioned.rows[0]?.is_active === true,
    'a member login was provisioned on a temporary password',
  );

  const jwt = token({ sub: userId, role: 'authenticated' });

  // ---- [2] the session reports the lock -----------------------------------
  const session = await rest('/rpc/my_session', jwt, { method: 'POST', body: '{}' });
  ok(
    session.status === 200 && session.body?.must_change_password === true,
    `my_session() reports the lock (must_change_password=${session.body?.must_change_password})`,
  );

  // ---- [3] and the lock holds ---------------------------------------------
  const before = await rest('/transactions?select=id', jwt);
  const membersBefore = await rest('/members?select=id', jwt);
  ok(
    Array.isArray(before.body) && before.body.length === 0 &&
      Array.isArray(membersBefore.body) && membersBefore.body.length === 0,
    `the temporary password reads nothing (${before.body?.length} transactions, ${membersBefore.body?.length} members)`,
  );

  // ---- [4] THE ATTACK -----------------------------------------------------
  const attack = await rest('/rpc/log_password_changed', jwt, { method: 'POST', body: '{}' });
  ok(
    attack.status === 404 || attack.status === 403 || attack.status === 401,
    `POST /rpc/log_password_changed is refused over REST (HTTP ${attack.status}${
      attack.body?.code ? `, ${attack.body.code}` : ''
    })`,
  );

  // The two halves of a verified change must be unreachable with this token.
  const begin = await rest('/rpc/begin_password_change', jwt, {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId }),
  });
  const complete = await rest('/rpc/complete_password_change', jwt, {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_nonce: '00000000-0000-0000-0000-000000000000' }),
  });
  ok(
    begin.status >= 400 && complete.status >= 400,
    `neither half of a verified password change is reachable with a member token (HTTP ${begin.status}/${complete.status})`,
  );

  // A retired reset entry point, too.
  const issue = await rest('/rpc/issue_temporary_password', jwt, {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId }),
  });
  ok(issue.status >= 400, `the retired issue_temporary_password() is refused (HTTP ${issue.status})`);

  // ---- [5] and [6] the lock must be exactly where it was ------------------
  const after = await rest('/rpc/my_session', jwt, { method: 'POST', body: '{}' });
  ok(
    after.body?.must_change_password === true,
    `after the attempt the lock still holds (must_change_password=${after.body?.must_change_password})`,
  );

  const txnsAfter = await rest('/transactions?select=id', jwt);
  const membersAfter = await rest('/members?select=id', jwt);
  const ledgerAfter = await rest('/account_ledger_entries?select=id', jwt);
  ok(
    txnsAfter.body?.length === 0 && membersAfter.body?.length === 0 && ledgerAfter.body?.length === 0,
    `and it still reads nothing (${txnsAfter.body?.length} transactions, ${membersAfter.body?.length} members, ${ledgerAfter.body?.length} ledger entries)`,
  );

  const flag = await client.query(
    'select must_change_password, password_set_at from app_users where id = $1',
    [userId],
  );
  ok(
    flag.rows[0]?.must_change_password === true && flag.rows[0]?.password_set_at === null,
    'the database agrees: the flag was never cleared and no password change was stamped',
  );

  const audit = await client.query(
    "select count(*)::int n from audit_logs where action = 'auth.password_changed' and record_id = $1",
    [userId],
  );
  ok(audit.rows[0].n === 0, `and no audit row claims a password change (${audit.rows[0].n} rows)`);

  const credential = await client.query('select encrypted_password from auth.users where id = $1', [
    userId,
  ]);
  ok(
    credential.rows[0]?.encrypted_password === HASH,
    'the temporary password is untouched, as it should be - nothing changed it',
  );

  // ---- the private proof store is not an API surface ----------------------
  const proofs = await rest('/change_proofs?select=user_id', jwt);
  const reservations = await rest('/reset_reservations?select=user_id', jwt);
  ok(
    proofs.status >= 400 && reservations.status >= 400,
    `the proof and reservation stores are not exposed through the API (HTTP ${proofs.status}/${reservations.status})`,
  );
} finally {
  if (userId) {
    await client.query('delete from auth.users where id = $1', [userId]).catch(() => {});
    await client.query('delete from app_users where id = $1', [userId]).catch(() => {});
  }
  await client.end();
}

console.log(`\n${failures} problem(s)`);
process.exit(failures ? 1 : 0);
