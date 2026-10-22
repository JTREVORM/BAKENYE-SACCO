/**
 * One Supabase-shaped origin in front of REAL GoTrue and REAL PostgREST.
 *
 *   node supabase-router.mjs
 *
 *   /auth/v1/*  ->  GoTrue      (GOTRUE_URL,   default http://127.0.0.1:9999)
 *   /rest/v1/*  ->  PostgREST   (POSTGREST_URL, default http://127.0.0.1:3002)
 *
 * WHY THIS EXISTS, AND HOW IT DIFFERS FROM gateway.mjs
 *
 * `../gateway.mjs` *imitates* GoTrue: it issues its own JWTs, hashes its own
 * passwords and implements the slice of the auth API this application happens
 * to call. That is enough to exercise the application, and it is what the
 * earlier certification ran against — but it cannot certify Supabase Auth
 * itself, because it is not Supabase Auth. Anything that depends on GoTrue's
 * real behaviour (bcrypt, token lifetimes, recovery tokens, refresh-token
 * rotation, session rows, its own validation) was out of reach.
 *
 * This router proxies to the real `supabase/auth` binary instead, built from
 * source by `build-gotrue.sh`. `@supabase/supabase-js` cannot tell the
 * difference between this and a hosted project, which is the point: the
 * lifecycle suite drives the same client the application uses.
 *
 * It is a proxy and nothing else. It mints no tokens, stores nothing, and
 * makes no decisions — so nothing it does can make a test pass that would fail
 * against a real project.
 *
 * TEST TOOLING. Never deployed, never pointed at a hosted project.
 */
import http from 'node:http';

const PORT = Number(process.env.ROUTER_PORT || 54321);
const GOTRUE = (process.env.GOTRUE_URL || 'http://127.0.0.1:9999').replace(/\/+$/, '');
const POSTGREST = (process.env.POSTGREST_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');

/** Hop-by-hop headers a proxy must not forward. */
const STRIP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host']);

function target(path) {
  if (path.startsWith('/auth/v1/')) return { base: GOTRUE, rest: path.slice('/auth/v1'.length) };
  if (path === '/auth/v1') return { base: GOTRUE, rest: '/' };
  if (path.startsWith('/rest/v1/')) return { base: POSTGREST, rest: path.slice('/rest/v1'.length) };
  if (path === '/rest/v1') return { base: POSTGREST, rest: '/' };
  return null;
}

const server = http.createServer(async (req, res) => {
  const route = target(req.url.split('?')[0]);
  if (!route) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not an /auth/v1 or /rest/v1 path' }));
    return;
  }

  const query = req.url.includes('?') ? `?${req.url.split('?').slice(1).join('?')}` : '';
  const url = `${route.base}${route.rest}${query}`;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!STRIP.has(k.toLowerCase())) headers[k] = v;
  }

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      redirect: 'manual',
    });
    const out = Buffer.from(await upstream.arrayBuffer());
    const outHeaders = {};
    upstream.headers.forEach((v, k) => {
      if (!STRIP.has(k.toLowerCase()) && k.toLowerCase() !== 'content-encoding') outHeaders[k] = v;
    });
    outHeaders['content-length'] = String(out.length);
    res.writeHead(upstream.status, outHeaders);
    res.end(out);
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: `router could not reach ${url}: ${error.message}` }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`supabase router on http://127.0.0.1:${PORT}`);
  console.log(`  /auth/v1 -> ${GOTRUE}   (real GoTrue)`);
  console.log(`  /rest/v1 -> ${POSTGREST} (real PostgREST)`);
});
