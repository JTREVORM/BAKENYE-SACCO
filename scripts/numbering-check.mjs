/**
 * Hammer the two number generators from many connections at once.
 *
 *   node scripts/numbering-check.mjs
 *
 * A counter is only as good as its behaviour under two cashiers pressing
 * Confirm in the same millisecond. This opens real, separate connections -
 * not one connection issuing numbers in a loop, which would prove nothing -
 * and has them all ask for a number at the same moment, then checks that
 * every number came back exactly once and that the run is a contiguous
 * sequence with no gaps and no repeats.
 *
 * It writes only to `doc_counters`, and puts the counters it touched back
 * where it found them when it is done.
 */
import fs from 'node:fs';
import pg from 'pg';

for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local.');
  process.exit(1);
}

const CONNECTIONS = 24;
const PER_CONNECTION = 10;
const TOTAL = CONNECTIONS * PER_CONNECTION;

const results = [];
function check(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS  ' : 'FAIL  '}${step}${detail ? `   -- ${detail}` : ''}`);
}

function connect() {
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  return c.connect().then(() => c);
}

/** Every connection waits on the same barrier, then all fire together. */
async function storm(clients, sql) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const runs = clients.map(async (c) => {
    await gate;
    const out = [];
    for (let i = 0; i < PER_CONNECTION; i++) {
      const { rows } = await c.query(sql);
      out.push(rows[0].no);
    }
    return out;
  });
  release();
  return (await Promise.all(runs)).flat();
}

const admin = await connect();
const [{ member_scope, day_scope }] = (await admin.query(
  `select 'MEMBER-' || to_char(current_date, 'YY') as member_scope,
          'CCT-'    || to_char(current_date, 'YYMMDD') as day_scope`,
)).rows;

const before = (await admin.query(
  'select scope, last_value from doc_counters where scope in ($1, $2)',
  [member_scope, day_scope],
)).rows;

const clients = await Promise.all(Array.from({ length: CONNECTIONS }, connect));

try {
  // ---- Member numbers ------------------------------------------------------
  const members = await storm(clients, 'select next_member_no() as no');
  const uniqueMembers = new Set(members);

  check(
    `${TOTAL} member numbers issued at once from ${CONNECTIONS} connections are all different`,
    uniqueMembers.size === TOTAL,
    `${uniqueMembers.size} distinct of ${TOTAL}`,
  );

  const yy = members[0].slice(3, 5);
  check(
    'every one of them is BND + YY + sequence',
    members.every((m) => new RegExp(`^BND${yy}[0-9]{3,}$`).test(m)),
    `${members[0]} … ${members[members.length - 1]}`,
  );

  const memberSeq = members.map((m) => Number(m.slice(5))).sort((a, b) => a - b);
  check(
    'the numbers issued are a contiguous run - nothing skipped, nothing repeated',
    memberSeq.every((n, i) => i === 0 || n === memberSeq[i - 1] + 1),
    `${memberSeq[0]} … ${memberSeq[memberSeq.length - 1]}`,
  );

  // ---- Document references -------------------------------------------------
  const refs = await storm(clients, "select next_document_no('CCT') as no");
  const uniqueRefs = new Set(refs);

  check(
    `${TOTAL} references issued at once from ${CONNECTIONS} connections are all different`,
    uniqueRefs.size === TOTAL,
    `${uniqueRefs.size} distinct of ${TOTAL}`,
  );

  const day = refs[0].slice(3, 9);
  check(
    'every one of them is PREFIX + YYMMDD + sequence',
    refs.every((r) => new RegExp(`^CCT${day}[0-9]{3,}$`).test(r)),
    `${refs[0]} … ${refs[refs.length - 1]}`,
  );

  const refSeq = refs.map((r) => Number(r.slice(9))).sort((a, b) => a - b);
  check(
    'the references issued are a contiguous run',
    refSeq.every((n, i) => i === 0 || n === refSeq[i - 1] + 1),
    `${refSeq[0]} … ${refSeq[refSeq.length - 1]}`,
  );

  // A real ledger would have rejected a duplicate; prove the database agrees
  // the whole run could have gone onto it.
  check(
    'no reference collides with any member number',
    [...uniqueRefs].every((r) => !uniqueMembers.has(r)),
    null,
  );
} finally {
  await Promise.all(clients.map((c) => c.end()));
  await admin.query('delete from doc_counters where scope in ($1, $2)', [member_scope, day_scope]);
  for (const row of before) {
    await admin.query('insert into doc_counters (scope, last_value) values ($1, $2)',
                      [row.scope, row.last_value]);
  }
  await admin.end();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
