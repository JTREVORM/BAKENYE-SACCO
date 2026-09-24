/**
 * Local Supabase-compatible gateway — DOCUMENTATION / TEST ENVIRONMENT ONLY.
 *
 * Serves the small slice of the Supabase API this application uses, so the real
 * Next.js app can be run and screenshotted without a hosted Supabase project:
 *
 *   /auth/v1/*   a GoTrue-shaped auth service backed by auth.users (bcrypt via pgcrypto)
 *   /rest/v1/*   proxied to a real PostgREST process
 *   /storage/v1  minimal stubs
 *
 * It never touches the SACCO's production data: it talks only to the throwaway
 * local Postgres cluster created for this documentation exercise.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const PORT = Number(process.env.GATEWAY_PORT || 54321);
const PGRST = process.env.PGRST_URL || 'http://127.0.0.1:3001';
const SECRET = process.env.JWT_SECRET;
const DB = process.env.DATABASE_URL;

const pool = new pg.Pool({ connectionString: DB, max: 10 });

// Object store for the Storage stand-in: files on local disk, metadata in the
// storage.objects table the migrations already create.
const STORE = process.env.STORAGE_DIR || '/var/tmp/bud-docs-stack/storage';
fs.mkdirSync(STORE, { recursive: true });
const objectFile = (bucket, key) =>
  path.join(STORE, bucket, crypto.createHash('sha256').update(key).digest('hex'));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  try {
    const [h, p, s] = token.split('.');
    const expect = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
    if (s !== expect) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch { return null; }
}

const ANON_KEY = sign({ role: 'anon', iss: 'supabase-local', iat: 1700000000, exp: 2000000000 });
const SERVICE_KEY = sign({ role: 'service_role', iss: 'supabase-local', iat: 1700000000, exp: 2000000000 });

function userJson(row) {
  return {
    id: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    phone: row.phone ?? '',
    email_confirmed_at: row.email_confirmed_at,
    confirmed_at: row.email_confirmed_at,
    last_sign_in_at: row.last_sign_in_at,
    app_metadata: { provider: 'email', providers: ['email'], ...(row.raw_app_meta_data || {}) },
    user_metadata: row.raw_user_meta_data || {},
    identities: [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_anonymous: false,
  };
}

function sessionFor(row) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const access_token = sign({
    sub: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    app_metadata: row.raw_app_meta_data || {},
    user_metadata: row.raw_user_meta_data || {},
    session_id: crypto.randomUUID(),
    iat: now,
    exp,
  });
  return {
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: sign({ sub: row.id, typ: 'refresh', iat: now, exp: now + 86400 * 7 }),
    user: userJson(row),
  };
}

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(s);
};
const authError = (res, code, msg, errCode) =>
  json(res, code, { code, error_code: errCode, msg, message: msg, error: errCode, error_description: msg });

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function findUser(where, params) {
  const { rows } = await pool.query(`select * from auth.users where ${where} limit 1`, params);
  return rows[0] || null;
}

async function handleAuth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, '') || '/';
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};

  // ---- sign in / refresh -------------------------------------------------
  if (path === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type') || 'password';
    if (grant === 'password') {
      const email = String(body.email || '').toLowerCase();
      const user = await findUser('lower(email) = $1 and deleted_at is null', [email]);
      if (!user) return authError(res, 400, 'Invalid login credentials', 'invalid_credentials');
      const ok = await pool.query(
        'select (encrypted_password = crypt($2, encrypted_password)) as ok from auth.users where id = $1',
        [user.id, String(body.password || '')],
      );
      if (!ok.rows[0]?.ok) return authError(res, 400, 'Invalid login credentials', 'invalid_credentials');
      await pool.query('update auth.users set last_sign_in_at = now() where id = $1', [user.id]);
      return json(res, 200, sessionFor(user));
    }
    if (grant === 'refresh_token') {
      const claims = verify(String(body.refresh_token || ''));
      if (!claims) return authError(res, 400, 'Invalid Refresh Token', 'refresh_token_not_found');
      const user = await findUser('id = $1', [claims.sub]);
      if (!user) return authError(res, 400, 'Invalid Refresh Token', 'refresh_token_not_found');
      return json(res, 200, sessionFor(user));
    }
    return authError(res, 400, 'Unsupported grant type', 'unsupported_grant_type');
  }

  // ---- current user ------------------------------------------------------
  if (path === '/user' && req.method === 'GET') {
    const claims = verify(bearer(req) || '');
    if (!claims?.sub) return authError(res, 401, 'invalid claim: missing sub claim', 'bad_jwt');
    const user = await findUser('id = $1', [claims.sub]);
    if (!user) return authError(res, 401, 'User from sub claim in JWT does not exist', 'user_not_found');
    return json(res, 200, userJson(user));
  }

  // ---- change own password ----------------------------------------------
  if (path === '/user' && req.method === 'PUT') {
    const claims = verify(bearer(req) || '');
    if (!claims?.sub) return authError(res, 401, 'invalid claim: missing sub claim', 'bad_jwt');
    if (body.password) {
      await pool.query(
        "update auth.users set encrypted_password = crypt($2, gen_salt('bf')), updated_at = now() where id = $1",
        [claims.sub, String(body.password)],
      );
    }
    const user = await findUser('id = $1', [claims.sub]);
    return json(res, 200, userJson(user));
  }

  if (path === '/logout' && req.method === 'POST') {
    res.writeHead(204).end();
    return;
  }

  if (path === '/recover' && req.method === 'POST') {
    // No mail transport in this test environment; the request is accepted so
    // the application's own "check your email" path can be documented.
    return json(res, 200, {});
  }

  // ---- admin -------------------------------------------------------------
  if (path === '/admin/users' && req.method === 'POST') {
    const claims = verify(bearer(req) || '');
    if (claims?.role !== 'service_role') return authError(res, 403, 'User not allowed', 'not_admin');
    const email = String(body.email || '').toLowerCase();
    const exists = await findUser('lower(email) = $1', [email]);
    if (exists) return authError(res, 422, 'A user with this email address has already been registered', 'email_exists');
    const { rows } = await pool.query(
      `insert into auth.users (email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
       values ($1, crypt($2, gen_salt('bf')), case when $3 then now() else null end, '{}'::jsonb, $4::jsonb)
       returning *`,
      [email, String(body.password || crypto.randomUUID()), body.email_confirm !== false,
       JSON.stringify(body.user_metadata || {})],
    );
    // app_metadata is written as a second statement so the database sees the
    // UPDATE that migration 0035 provisions on.
    const created = rows[0];
    if (body.app_metadata && Object.keys(body.app_metadata).length) {
      const upd = await pool.query(
        'update auth.users set raw_app_meta_data = $2::jsonb, updated_at = now() where id = $1 returning *',
        [created.id, JSON.stringify(body.app_metadata)],
      );
      return json(res, 200, userJson(upd.rows[0]));
    }
    return json(res, 200, userJson(created));
  }

  const adminUser = path.match(/^\/admin\/users\/([0-9a-f-]{36})$/i);
  if (adminUser && (req.method === 'PUT' || req.method === 'PATCH')) {
    const claims = verify(bearer(req) || '');
    if (claims?.role !== 'service_role') return authError(res, 403, 'User not allowed', 'not_admin');
    const id = adminUser[1];
    if (body.password) {
      await pool.query(
        "update auth.users set encrypted_password = crypt($2, gen_salt('bf')), updated_at = now() where id = $1",
        [id, String(body.password)],
      );
    }
    if (body.app_metadata) {
      await pool.query('update auth.users set raw_app_meta_data = raw_app_meta_data || $2::jsonb where id = $1',
        [id, JSON.stringify(body.app_metadata)]);
    }
    if (body.email) {
      await pool.query('update auth.users set email = $2 where id = $1', [id, String(body.email).toLowerCase()]);
    }
    const user = await findUser('id = $1', [id]);
    if (!user) return authError(res, 404, 'User not found', 'user_not_found');
    return json(res, 200, userJson(user));
  }
  if (adminUser && req.method === 'GET') {
    const claims = verify(bearer(req) || '');
    if (claims?.role !== 'service_role') return authError(res, 403, 'User not allowed', 'not_admin');
    const user = await findUser('id = $1', [adminUser[1]]);
    if (!user) return authError(res, 404, 'User not found', 'user_not_found');
    return json(res, 200, userJson(user));
  }

  if (path === '/settings' && req.method === 'GET') {
    return json(res, 200, { external: {}, disable_signup: true, mailer_autoconfirm: true });
  }

  return authError(res, 404, `Not found: ${req.method} ${path}`, 'not_found');
}

function proxy(req, res, target, stripPrefix) {
  const u = new URL(req.url, 'http://x');
  const path = u.pathname.replace(stripPrefix, '') + u.search;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  // PostgREST authenticates from the bearer token; the apikey header is ours.
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const payload = Buffer.concat(chunks);
    const t = new URL(target);
    const upstream = http.request(
      { hostname: t.hostname, port: t.port, path, method: req.method, headers },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    upstream.on('error', (e) => json(res, 502, { message: `upstream: ${e.message}` }));
    if (payload.length) upstream.write(payload);
    upstream.end();
  });
}


/* ---------------------------------------------------------------- storage --
 * A small stand-in for Supabase Storage: upload, download and signed links,
 * enough to exercise the application's supporting-document path. Objects live
 * on local disk; their metadata goes in storage.objects, so the bucket
 * policies the migrations create still apply to the listing.
 * ------------------------------------------------------------------------ */
async function handleStorage(req, res, url) {
  const p = url.pathname.replace(/^\/storage\/v1/, '');
  const claims = verify(bearer(req) || '');

  // POST /object/sign/<bucket>/<key...>  -> { signedURL }
  const sign = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/);
  if (sign && req.method === 'POST') {
    const [, bucket, key] = sign;
    const body = await readBody(req);
    const expires = Number(body.expiresIn || 60);
    const exp = Math.floor(Date.now() / 1000) + expires;
    const token = sign_(`${bucket}/${decodeURIComponent(key)}|${exp}`);
    const signedURL = `/object/sign/${bucket}/${key}?token=${token}&exp=${exp}`;
    return json(res, 200, { signedURL });
  }

  // GET /object/sign/<bucket>/<key...>?token=&exp=  -> the bytes
  if (sign && req.method === 'GET') {
    const [, bucket, key] = sign;
    const token = url.searchParams.get('token');
    const exp = Number(url.searchParams.get('exp'));
    const want = sign_(`${bucket}/${decodeURIComponent(key)}|${exp}`);
    if (token !== want) {
      return json(res, 400, { statusCode: '400', error: 'InvalidSignature', message: 'bad token' });
    }
    if (exp * 1000 < Date.now()) {
      return json(res, 400, { statusCode: '400', error: 'ExpiredToken', message: 'link expired' });
    }
    const file = objectFile(bucket, key);
    if (!fs.existsSync(file)) {
      return json(res, 404, { statusCode: '404', error: 'NotFound', message: 'not found' });
    }
    const meta = await pool.query(
      'select metadata->>\'mimetype\' as mime from storage.objects where bucket_id=$1 and name=$2 limit 1',
      [bucket, decodeURIComponent(key)],
    ).catch(() => ({ rows: [] }));
    res.writeHead(200, { 'content-type': meta.rows[0]?.mime || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }

  // POST /object/<bucket>/<key...> — checked last, because the signing routes
  // above would otherwise be read as an upload into a bucket called "sign".
  const up = p.match(/^\/object\/([^/]+)\/(.+)$/);
  if (up && req.method === 'POST') {
    if (!claims?.sub && claims?.role !== 'service_role') {
      return json(res, 401, { statusCode: '401', error: 'Unauthorized', message: 'not signed in' });
    }
    const [, bucket, key] = up;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    await new Promise((r) => req.on('end', r));
    const body = Buffer.concat(chunks);

    // supabase-js posts the file as multipart/form-data. Pull the file part
    // out so what lands on disk is the document itself, not the envelope.
    let content = body;
    let mime = req.headers['content-type'] || null;
    const ct = req.headers['content-type'] || '';
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct);
    if (boundary) {
      const mark = Buffer.from(`--${boundary[1] || boundary[2]}`);
      let from = body.indexOf(mark);
      while (from !== -1) {
        const next = body.indexOf(mark, from + mark.length);
        if (next === -1) break;
        const part = body.subarray(from + mark.length, next);
        const sep = part.indexOf('\r\n\r\n');
        const headers = part.subarray(0, sep).toString();
        if (/filename=/.test(headers)) {
          content = part.subarray(sep + 4, part.length - 2);   // drop the trailing CRLF
          const m = /content-type:\s*([^\r\n]+)/i.exec(headers);
          if (m) mime = m[1].trim();
          break;
        }
        from = next;
      }
    }

    const dest = objectFile(bucket, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) {
      return json(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    }
    fs.writeFileSync(dest, content);
    await pool.query(
      `insert into storage.objects (bucket_id, name, owner, metadata, path_tokens)
       values ($1, $2, $3, $4::jsonb, string_to_array($2, '/'))`,
      [bucket, decodeURIComponent(key), claims?.sub ?? null,
       JSON.stringify({ size: content.length, mimetype: mime })],
    ).catch(() => {});
    return json(res, 200, { Key: `${bucket}/${decodeURIComponent(key)}`, Id: crypto.randomUUID() });
  }

  return json(res, 404, { statusCode: '404', error: 'NotFound', message: `no route ${req.method} ${p}` });
}

/** HMAC used only for the storage link signature. */
function sign_(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    });
    return res.end();
  }
  if (url.pathname.startsWith('/auth/v1')) return void handleAuth(req, res, url).catch((e) => json(res, 500, { message: e.message }));
  if (url.pathname.startsWith('/rest/v1')) return proxy(req, res, PGRST, '/rest/v1');
  if (url.pathname.startsWith('/storage/v1'))
    return void handleStorage(req, res, url).catch((e) => json(res, 500, { message: e.message }));
  return json(res, 404, { message: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`gateway on http://127.0.0.1:${PORT}`);
  console.log(`ANON_KEY=${ANON_KEY}`);
  console.log(`SERVICE_KEY=${SERVICE_KEY}`);
});
