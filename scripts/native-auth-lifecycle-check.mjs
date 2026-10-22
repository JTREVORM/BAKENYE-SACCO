/**
 * Native Supabase Auth (GoTrue) lifecycle certification.
 *
 *   documentation/source/test-stack/native-auth/up.sh     # build and start the stack
 *   node scripts/native-auth-lifecycle-check.mjs
 *
 * WHAT MAKES THIS DIFFERENT FROM EVERY EARLIER AUTH TEST
 *
 * The SQL suites prove the control inside PostgreSQL. `password-security-rest-check.mjs`
 * proves it at the PostgREST boundary with a hand-minted bearer token. Neither
 * involves Supabase Auth: the earlier stack's `gateway.mjs` *imitates* GoTrue,
 * issuing its own tokens and hashing its own passwords, so everything that
 * depends on GoTrue's real behaviour was modelled rather than exercised. The
 * SQL suites stand in for a credential change by writing
 * `auth.users.encrypted_password` directly.
 *
 * This suite runs against the real `supabase/auth` binary, through
 * `@supabase/supabase-js` — the same client the application uses. So the things
 * that could only be asserted by proxy before are now observed:
 *
 *   · passwords are hashed and verified by GoTrue's own bcrypt
 *   · an old password genuinely stops working after a change
 *   · tokens are real GoTrue JWTs, with real sessions and refresh rotation
 *   · recovery tokens are real, and so is the redirect allow-list
 *   · a staff reset really does install a credential through the Admin API
 *
 * ISOLATION
 *
 * Everything runs against a disposable local PostgreSQL database that this
 * stack creates, a GoTrue built from source, and a local PostgREST. There is no
 * route to a hosted project: the connection strings are local, the JWT secret
 * is generated for the stack, and the suite refuses to run unless
 * NATIVE_AUTH_ALLOW_WRITES says the database is disposable. Every account it
 * touches it creates. No production or preview credential is involved.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const URL_BASE = process.env.NATIVE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NATIVE_ANON_KEY;
const SERVICE = process.env.NATIVE_SERVICE_KEY;
const DB = process.env.NATIVE_DATABASE_URL;

if (!ANON || !SERVICE || !DB) {
  console.error('Set NATIVE_ANON_KEY, NATIVE_SERVICE_KEY and NATIVE_DATABASE_URL.');
  console.error('documentation/source/test-stack/native-auth/up.sh prints them.');
  process.exit(1);
}
if (!process.env.NATIVE_AUTH_ALLOW_WRITES) {
  console.error(
    'This suite creates logins and changes their passwords. Set\n' +
      'NATIVE_AUTH_ALLOW_WRITES=1 to confirm the database it points at is a\n' +
      "disposable one, never the SACCO's.",
  );
  process.exit(1);
}

let failures = 0;
const results = [];
const ok = (id, pass, text) => {
  if (!pass) failures += 1;
  results.push({ id, pass: !!pass, text });
  console.log(`${pass ? '✔' : '✖'} [${id}] ${text}`);
};
const note = (text) => console.log(`   · ${text}`);
const section = (title) => console.log(`\n── ${title}`);

/** The application's own recovery policy, read from its real source. */
function loadRecoveryPolicy() {
  const source = new URL('../src/lib/recovery.ts', import.meta.url);
  const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n })`)(
    createRequire(source),
    mod,
    mod.exports,
  );
  return mod.exports;
}

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: DB, ssl: false });
await db.connect();

/** A fresh anon-key client, one per identity, as a browser would have. */
const anonClient = () => createClient(URL_BASE, ANON, { auth: { persistSession: false } });

/**
 * A per-run suffix on every address this suite creates.
 *
 * An account that has acted cannot be deleted — `audit_logs.actor_id` is a
 * foreign key to `app_users`, and the SACCO must never lose who did something.
 * So the cleanup releases the member link but the Auth row survives, and a
 * second run on the same database would collide on the email address. A unique
 * address per run makes the suite repeatable without asking the audit trail to
 * forget anything.
 */
const RUN = Math.random().toString(36).slice(2, 8);

const TEMP_1 = 'TempPass11';
const CHOSEN = 'MemberChose22';
const created = [];
/** Member records whose status this run changes, restored in the finally block. */
const touchedMembers = [];

function decodeJwt(token) {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

try {
  // =======================================================================
  section('A. Password creation — provisioning a member login through GoTrue');
  // =======================================================================
  const { rows: freeMembers } = await db.query(
    'select id, member_no from members where user_id is null order by member_no limit 2',
  );
  if (freeMembers.length < 2) throw new Error('This suite needs two seeded members without logins.');
  const member = freeMembers[0];
  const other = freeMembers[1];

  const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
    email: `native-${RUN}-${member.member_no.toLowerCase()}@members.bnd-sacco.invalid`,
    password: TEMP_1,
    email_confirm: true,
    app_metadata: { member_id: member.id },
  });
  ok(
    'create-user',
    !createError && !!createdUser?.user?.id,
    `GoTrue created a member login with a temporary password (${createError?.message ?? 'ok'})`,
  );
  const userId = createdUser.user.id;
  created.push(userId);

  const provisioned = await db.query(
    'select role, is_active, must_change_password, password_set_at from app_users where id = $1',
    [userId],
  );
  ok(
    'provision-trigger',
    provisioned.rows[0]?.role === 'member' &&
      provisioned.rows[0]?.is_active === true &&
      provisioned.rows[0]?.must_change_password === true &&
      provisioned.rows[0]?.password_set_at === null,
    'the SACCO provisioning trigger linked it to the member and started it on a forced change',
  );
  ok(
    'member-linked',
    (await db.query('select user_id from members where id = $1', [member.id])).rows[0].user_id === userId,
    'and the member record points at exactly that login',
  );

  const hash0 = (await db.query('select encrypted_password from auth.users where id = $1', [userId]))
    .rows[0].encrypted_password;
  ok(
    'real-bcrypt',
    /^\$2[aby]\$\d{2}\$/.test(hash0) && hash0.length >= 59,
    `GoTrue stored a real bcrypt hash, not the plaintext (${hash0.slice(0, 7)}…, ${hash0.length} chars)`,
  );

  // =======================================================================
  section('B. Sessions — real tokens, real refresh rotation');
  // =======================================================================
  const memberClient = anonClient();
  const { data: signIn, error: signInError } = await memberClient.auth.signInWithPassword({
    email: createdUser.user.email,
    password: TEMP_1,
  });
  ok(
    'signin-temp',
    !signInError && !!signIn?.session?.access_token && !!signIn?.session?.refresh_token,
    `the temporary password signs in and yields a session (${signInError?.message ?? 'ok'})`,
  );

  const claims = decodeJwt(signIn.session.access_token);
  ok(
    'jwt-claims',
    claims.sub === userId && claims.role === 'authenticated' && claims.aud === 'authenticated' &&
      typeof claims.exp === 'number',
    `the access token is a real GoTrue JWT (sub matches, role=${claims.role}, exp in ${Math.round((claims.exp - claims.iat) / 60)} min)`,
  );

  const sessionRows = await db.query('select count(*)::int n from auth.sessions where user_id = $1', [userId]);
  const refreshRows = await db.query(
    'select count(*)::int n from auth.refresh_tokens where user_id = $1::text',
    [userId],
  );
  ok(
    'session-recorded',
    sessionRows.rows[0].n >= 1 && refreshRows.rows[0].n >= 1,
    `GoTrue recorded the session and its refresh token (${sessionRows.rows[0].n} session(s), ${refreshRows.rows[0].n} refresh token(s))`,
  );

  const { data: refreshed, error: refreshError } = await memberClient.auth.refreshSession({
    refresh_token: signIn.session.refresh_token,
  });
  ok(
    'refresh-rotates',
    !refreshError &&
      !!refreshed?.session?.access_token &&
      refreshed.session.refresh_token !== signIn.session.refresh_token,
    `refreshing returns a new access token and rotates the refresh token (${refreshError?.message ?? 'ok'})`,
  );

  // =======================================================================
  section('C. The forced-change lock, attacked with a REAL GoTrue token');
  // =======================================================================
  const locked = anonClient();
  await locked.auth.signInWithPassword({ email: createdUser.user.email, password: TEMP_1 });

  const txnsLocked = await locked.from('transactions').select('id');
  const membersLocked = await locked.from('members').select('id');
  ok(
    'lock-holds-before',
    (txnsLocked.data ?? []).length === 0 && (membersLocked.data ?? []).length === 0,
    `on a temporary password a real session reads nothing (${(txnsLocked.data ?? []).length} transactions, ${(membersLocked.data ?? []).length} members)`,
  );

  const bypass = await locked.rpc('log_password_changed');
  ok(
    'bypass-refused',
    !!bypass.error,
    `the retired log_password_changed() is refused to a real session (${bypass.error?.code ?? 'NOT REFUSED'})`,
  );

  const beginAttempt = await locked.rpc('begin_password_change', { p_user_id: userId });
  const completeAttempt = await locked.rpc('complete_password_change', {
    p_user_id: userId,
    p_nonce: '00000000-0000-0000-0000-000000000000',
  });
  ok(
    'halves-unreachable',
    !!beginAttempt.error && !!completeAttempt.error,
    `neither half of a verified change is reachable with the member's own token (${beginAttempt.error?.code}/${completeAttempt.error?.code})`,
  );

  const stillLocked = await db.query(
    'select must_change_password, password_set_at from app_users where id = $1',
    [userId],
  );
  const txnsAfter = await locked.from('transactions').select('id');
  ok(
    'lock-holds-after',
    stillLocked.rows[0].must_change_password === true &&
      stillLocked.rows[0].password_set_at === null &&
      (txnsAfter.data ?? []).length === 0,
    'and after the attempt the lock is exactly where it was',
  );
  ok(
    'no-false-audit',
    (await db.query(
      "select count(*)::int n from audit_logs where action = 'auth.password_changed' and record_id = $1",
      [userId],
    )).rows[0].n === 0,
    'with no audit row claiming a password change',
  );

  // =======================================================================
  section('D. Password update — the verified ceremony against real GoTrue');
  // =======================================================================
  const nonce = await admin.rpc('begin_password_change', { p_user_id: userId });
  ok('proof-minted', !nonce.error && !!nonce.data, `the server opened a change (${nonce.error?.message ?? 'ok'})`);

  const { error: updateError } = await locked.auth.updateUser({ password: CHOSEN });
  const hash1 = (await db.query('select encrypted_password from auth.users where id = $1', [userId]))
    .rows[0].encrypted_password;
  ok(
    'credential-changed',
    !updateError && hash1 !== hash0 && /^\$2[aby]\$/.test(hash1),
    `GoTrue really changed the credential — the bcrypt hash moved (${updateError?.message ?? 'ok'})`,
  );

  const completion = await admin.rpc('complete_password_change', { p_user_id: userId, p_nonce: nonce.data });
  const afterChange = await db.query(
    'select must_change_password, password_set_at from app_users where id = $1',
    [userId],
  );
  ok(
    'lock-lifted',
    !completion.error &&
      afterChange.rows[0].must_change_password === false &&
      afterChange.rows[0].password_set_at !== null,
    `the lock lifted only once the hash had demonstrably moved (${completion.error?.message ?? 'ok'})`,
  );
  ok(
    'audit-once',
    (await db.query(
      "select count(*)::int n from audit_logs where action = 'auth.password_changed' and record_id = $1",
      [userId],
    )).rows[0].n === 1,
    'and the change is recorded exactly once',
  );

  const settled = anonClient();
  const { error: oldPasswordError } = await settled.auth.signInWithPassword({
    email: createdUser.user.email,
    password: TEMP_1,
  });
  ok(
    'old-password-dead',
    !!oldPasswordError,
    `the OLD temporary password no longer signs in (${oldPasswordError?.message ?? 'STILL WORKS'})`,
  );

  const { data: newSignIn, error: newPasswordError } = await settled.auth.signInWithPassword({
    email: createdUser.user.email,
    password: CHOSEN,
  });
  ok(
    'new-password-works',
    !newPasswordError && !!newSignIn?.session,
    `and the password the member chose does (${newPasswordError?.message ?? 'ok'})`,
  );

  const ownRecords = await settled.from('members').select('id');
  ok(
    'own-records-open',
    (ownRecords.data ?? []).length === 1 && ownRecords.data[0].id === member.id,
    `the settled member now reads exactly one member record — their own (${(ownRecords.data ?? []).length})`,
  );

  const replay = await admin.rpc('complete_password_change', { p_user_id: userId, p_nonce: nonce.data });
  ok('proof-single-use', !!replay.error, `replaying the proof is refused (${replay.error?.code ?? 'ACCEPTED'})`);

  // =======================================================================
  section('E. Staff-assisted reset against the real Admin API (F-04)');
  // =======================================================================
  const officer = anonClient();
  await officer.auth.signInWithPassword({
    email: process.env.NATIVE_ADMIN_EMAIL,
    password: process.env.NATIVE_ADMIN_PASSWORD,
  });

  // ---- the failure path: Auth never installs the replacement -------------
  const reserve1 = await officer.rpc('begin_temporary_password_reset', { p_user_id: userId });
  ok(
    'reset-started',
    !reserve1.error &&
      (await db.query('select must_change_password from app_users where id = $1', [userId])).rows[0]
        .must_change_password === true &&
      (await db.query(
        "select count(*)::int n from audit_logs where action = 'account.password_reset_started' and record_id = $1",
        [userId],
      )).rows[0].n === 1 &&
      (await db.query(
        "select count(*)::int n from audit_logs where action = 'account.password_reset' and record_id = $1",
        [userId],
      )).rows[0].n === 0,
    'a reset confines the account at once and records only that it was started',
  );

  const prematureComplete = await officer.rpc('complete_temporary_password_reset', {
    p_user_id: userId,
    p_token: reserve1.data.token,
  });
  ok(
    'reset-needs-credential',
    !!prematureComplete.error &&
      (await db.query(
        "select count(*)::int n from audit_logs where action = 'account.password_reset' and record_id = $1",
        [userId],
      )).rows[0].n === 0,
    `completion is refused while GoTrue has not installed anything, so no reset is falsely recorded (${prematureComplete.error?.code})`,
  );

  const aborted = await officer.rpc('abort_temporary_password_reset', {
    p_user_id: userId,
    p_token: reserve1.data.token,
  });
  ok(
    'reset-aborts-clean',
    !aborted.error &&
      (await db.query('select must_change_password from app_users where id = $1', [userId])).rows[0]
        .must_change_password === false &&
      (await db.query(
        "select count(*)::int n from audit_logs where action = 'account.password_reset_failed' and record_id = $1",
        [userId],
      )).rows[0].n === 1,
    'and an abort restores the standing the account had, recording the failure',
  );

  const stillMine = anonClient();
  const { error: survivedError } = await stillMine.auth.signInWithPassword({
    email: createdUser.user.email,
    password: CHOSEN,
  });
  ok(
    'abort-keeps-password',
    !survivedError,
    `after an aborted reset the member's own password still works (${survivedError?.message ?? 'ok'})`,
  );

  // ---- the success path --------------------------------------------------
  const TEMP_2 = 'StaffIssued33';
  const reserve2 = await officer.rpc('begin_temporary_password_reset', { p_user_id: userId });
  const { error: adminUpdateError } = await admin.auth.admin.updateUserById(userId, { password: TEMP_2 });
  const hash2 = (await db.query('select encrypted_password from auth.users where id = $1', [userId]))
    .rows[0].encrypted_password;
  ok(
    'admin-installed',
    !adminUpdateError && hash2 !== hash1,
    `the Admin API installed a new temporary password (${adminUpdateError?.message ?? 'ok'})`,
  );

  const complete2 = await officer.rpc('complete_temporary_password_reset', {
    p_user_id: userId,
    p_token: reserve2.data.token,
  });
  ok(
    'reset-completed',
    !complete2.error &&
      (await db.query('select must_change_password from app_users where id = $1', [userId])).rows[0]
        .must_change_password === true &&
      (await db.query(
        "select count(*)::int n from audit_logs where action = 'account.password_reset' and record_id = $1",
        [userId],
      )).rows[0].n === 1,
    'the completed reset leaves the account locked and records the issue exactly once',
  );

  const afterReset = anonClient();
  const { error: chosenDead } = await afterReset.auth.signInWithPassword({
    email: createdUser.user.email,
    password: CHOSEN,
  });
  ok('reset-kills-old', !!chosenDead, `the member's previous password no longer works (${chosenDead?.message ?? 'STILL WORKS'})`);

  const relocked = anonClient();
  await relocked.auth.signInWithPassword({ email: createdUser.user.email, password: TEMP_2 });
  const relockedTxns = await relocked.from('transactions').select('id');
  ok(
    'reset-relocks',
    (relockedTxns.data ?? []).length === 0 &&
      (await relocked.rpc('my_session')).data?.must_change_password === true,
    'and the new temporary password signs in to a confined session, nothing more',
  );

  // =======================================================================
  section('F. Recovery — real tokens, and the restrictions around them');
  // =======================================================================
  const policy = loadRecoveryPolicy();
  ok(
    'policy-suspended',
    policy.SELF_SERVICE_RECOVERY_ENABLED === false &&
      typeof policy.RECOVERY_SUSPENDED_MESSAGE === 'string' &&
      policy.RECOVERY_SUSPENDED_MESSAGE.includes('temporarily unavailable'),
    'the application still has self-service recovery switched off',
  );

  // GoTrue itself will happily mint a recovery token - the restriction is the
  // application's, which is exactly why it has to be enforced server-side in
  // the action, resetPassword() and /auth/callback rather than in the screen.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: createdUser.user.email,
  });
  ok(
    'gotrue-mints-recovery',
    !linkError && !!link?.properties?.hashed_token,
    `GoTrue does mint a recovery token when asked, so the suspension must be the application's (${linkError?.message ?? 'ok'})`,
  );

  // The security question that matters: can a recovery-derived session lift the
  // temporary-password lock? Before migration 0049 it could - that was F-01 by
  // another route, since resetPassword() called log_password_changed().
  const recoveryClient = anonClient();
  const { data: verified, error: verifyError } = await recoveryClient.auth.verifyOtp({
    email: createdUser.user.email,
    token: link.properties.email_otp,
    type: 'recovery',
  });
  ok(
    'recovery-session-real',
    !verifyError && !!verified?.session?.access_token,
    `a real recovery token exchanges for a real session (${verifyError?.message ?? 'ok'})`,
  );

  if (verified?.session) {
    const recBypass = await recoveryClient.rpc('log_password_changed');
    const recBegin = await recoveryClient.rpc('begin_password_change', { p_user_id: userId });
    const recComplete = await recoveryClient.rpc('complete_password_change', {
      p_user_id: userId,
      p_nonce: '00000000-0000-0000-0000-000000000000',
    });
    ok(
      'recovery-cannot-unlock',
      !!recBypass.error && !!recBegin.error && !!recComplete.error &&
        (await db.query('select must_change_password from app_users where id = $1', [userId])).rows[0]
          .must_change_password === true,
      'but a recovery session cannot lift the forced-change lock by any route, and the lock holds',
    );

    const recReads = await recoveryClient.from('transactions').select('id');
    ok(
      'recovery-reads-nothing',
      (recReads.data ?? []).length === 0,
      `and it reads no records while the account is confined (${(recReads.data ?? []).length})`,
    );
  }

  // F-03: the audit could not read the hosted redirect allow-list. Here it is
  // configured to the site URL only, and GoTrue is asked to honour an
  // attacker's host.
  const { data: evilLink, error: evilError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: createdUser.user.email,
    options: { redirectTo: 'https://attacker.example/steal' },
  });
  /** The destination GoTrue actually put in the link. */
  const redirectOf = (actionLink) => {
    if (!actionLink) return null;
    try {
      return new URL(actionLink).searchParams.get('redirect_to');
    } catch {
      return null;
    }
  };

  const SITE = 'http://127.0.0.1:3000';
  const ALLOWED = `${SITE}/auth/callback?next=/reset-password`;
  const evilRedirect = redirectOf(evilLink?.properties?.action_link);

  // Not merely "the attacker's host is absent" — GoTrue must have *replaced* it
  // with the Site URL, which is the documented fallback and the behaviour the
  // whole of F-03 turned on.
  ok(
    'redirect-allowlist',
    evilRedirect === SITE,
    `an off-allow-list redirectTo is discarded and replaced by the Site URL (asked for https://attacker.example/steal, link carries ${
      evilError?.message ?? JSON.stringify(evilRedirect)
    })`,
  );

  // The positive control, without which the assertion above proves nothing: a
  // GoTrue that ignored redirectTo altogether would also drop the attacker's
  // host. An allow-listed destination must survive intact, path and query and
  // all - which the Site-URL fallback would not.
  const { data: goodLink, error: goodLinkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: createdUser.user.email,
    options: { redirectTo: ALLOWED },
  });
  const goodRedirect = redirectOf(goodLink?.properties?.action_link);
  ok(
    'redirect-allowlist-positive',
    goodRedirect === ALLOWED,
    `and an allow-listed redirectTo survives intact, so the check above is a real filter rather than a no-op (${
      goodLinkError?.message ?? JSON.stringify(goodRedirect)
    })`,
  );
  note('This is the control that decides whether F-03 was ever exploitable.');
  note('It is asserted here against a GOTRUE_URI_ALLOW_LIST set to the site URL only;');
  note("the hosted project's own allow-list still has to be checked and tightened.");

  // =======================================================================
  section('G. Account standing is the SACCO\'s, not GoTrue\'s');
  // =======================================================================
  const { data: otherUser } = await admin.auth.admin.createUser({
    email: `native-${RUN}-${other.member_no.toLowerCase()}@members.bnd-sacco.invalid`,
    password: 'SuspendMe44',
    email_confirm: true,
    app_metadata: { member_id: other.id },
  });
  created.push(otherUser.user.id);
  // Settle them, then suspend the member record.
  const n2 = await admin.rpc('begin_password_change', { p_user_id: otherUser.user.id });
  const susClient = anonClient();
  await susClient.auth.signInWithPassword({ email: otherUser.user.email, password: 'SuspendMe44' });
  await susClient.auth.updateUser({ password: 'SuspendMe55' });
  await admin.rpc('complete_password_change', { p_user_id: otherUser.user.id, p_nonce: n2.data });
  touchedMembers.push(other.id);
  await db.query("update members set status = 'suspended' where id = $1", [other.id]);

  const suspended = anonClient();
  const { error: suspendedSignInError } = await suspended.auth.signInWithPassword({
    email: otherUser.user.email,
    password: 'SuspendMe55',
  });
  const suspendedSession = await suspended.rpc('my_session');
  ok(
    'suspended-refused-by-app',
    !suspendedSignInError && suspendedSession.data?.member?.status === 'suspended',
    'GoTrue admits a suspended member (it knows nothing of SACCO standing); my_session reports the suspension so the application refuses',
  );
  note('admitOrRefuse() signs this session straight back out — that is the app-level gate.');

  await db.query('update app_users set is_active = false where id = $1', [otherUser.user.id]);
  const deactivated = anonClient();
  await deactivated.auth.signInWithPassword({ email: otherUser.user.email, password: 'SuspendMe55' });
  const deactivatedReads = await deactivated.from('members').select('id');
  const deactivatedPerm = await deactivated.rpc('has_permission', { p_key: 'portal.view' });
  ok(
    'deactivated-reads-nothing',
    (deactivatedReads.data ?? []).length === 0 && deactivatedPerm.data === false,
    `a deactivated account holds a valid GoTrue session and still reads nothing (${(deactivatedReads.data ?? []).length} rows, portal.view=${deactivatedPerm.data})`,
  );

  // =======================================================================
  section('H. Sign-out and token lifetime — observed, not assumed');
  // =======================================================================
  const signOutClient = anonClient();
  const { data: toRevoke } = await signOutClient.auth.signInWithPassword({
    email: createdUser.user.email,
    password: TEMP_2,
  });
  await signOutClient.auth.signOut();
  const afterSignOut = await anonClient().auth.refreshSession({
    refresh_token: toRevoke.session.refresh_token,
  });
  ok(
    'signout-revokes-refresh',
    !!afterSignOut.error,
    `signing out revokes the refresh token, so no new access token can be minted (${afterSignOut.error?.message ?? 'STILL VALID'})`,
  );

  const staleClaims = decodeJwt(toRevoke.session.access_token);
  const lifetime = staleClaims.exp - staleClaims.iat;
  note(
    `The access token already issued stays valid until it expires (${Math.round(lifetime / 60)} min) — ` +
      'JWTs are stateless and Supabase documents this.',
  );
  note(
    'What bounds a signed-out session in the application is the idle-timeout cookie ' +
      'and the Clear-Site-Data on /auth/signout, not token revocation (F-08).',
  );
  ok(
    'token-lifetime-bounded',
    lifetime > 0 && lifetime <= 3600,
    `and that window is bounded and short (${Math.round(lifetime / 60)} min)`,
  );
} catch (error) {
  console.error(`\n✖ the suite did not complete: ${error instanceof Error ? error.stack : error}`);
  failures += 1;
} finally {
  // Put back every row this run touched, so the suite is repeatable on the same
  // database rather than quietly consuming two members per run — the
  // order-dependent, shared-state fault the audit recorded as F-13.
  //
  // Note what cannot be undone, and should not be: an account that has acted
  // has rows in `audit_logs` referencing it, and `audit_logs.actor_id` is a
  // foreign key to `app_users`. So deleting the login fails with
  // `audit_logs_actor_id_fkey` once it has any history. That is the immutable
  // audit trail doing its job — the SACCO must never lose who did something —
  // so the cleanup releases the member link and switches the account off
  // instead of pretending it can erase it.
  for (const id of created) {
    await db.query('update members set user_id = null where user_id = $1', [id]).catch(() => {});
    const { error: deleteError } = await admin.auth.admin.deleteUser(id).catch((e) => ({ error: e }));
    if (deleteError) {
      // Expected for any account with audit history. Leave it switched off.
      await db
        .query('update app_users set is_active = false where id = $1', [id])
        .catch(() => {});
    }
  }
  // The suspension and deactivation this run applied are its own doing too.
  for (const id of touchedMembers) {
    await db.query("update members set status = 'active' where id = $1", [id]).catch(() => {});
  }
  if (process.env.NATIVE_AUTH_REPORT) {
    fs.writeFileSync(
      process.env.NATIVE_AUTH_REPORT,
      `${JSON.stringify({ failures, assertions: results }, null, 2)}\n`,
    );
  }
  await db.end().catch(() => {});
}

console.log(`\n${results.filter((r) => r.pass).length} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
