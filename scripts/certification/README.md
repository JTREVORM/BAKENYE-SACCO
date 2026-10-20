# Isolated dashboard certification

This tooling never discovers, links or resets a hosted Supabase project. It
generates its own credentials and uses loopback endpoints, a dedicated Docker
network, labelled disposable containers and a private database identity marker.
Mutation runners verify that marker before accessing synthetic records.
The application, migrations, permissions and financial functions are unchanged.

The older `documentation/source/test-stack/gateway.mjs` emulates authentication
and is unsuitable for real session certification. This stack uses **real
GoTrue v2.197.0**, **PostgREST v13.0.7** and **PostgreSQL 16** instead. There is
no Supabase CLI configuration or CI workflow in this repository. All 48 existing
migrations run in order against an empty database; no production dump or
`supabase/seed.sql` is imported. The older storage SQL supplies only the minimal
storage metadata tables required by those migrations; its Auth stand-ins are
never loaded. Native GoTrue creates its own Auth schema and helper functions.

Requirements: installed project dependencies, Docker on the managed local Unix
socket, the three images above, and Chromium. Keep the session's required network
proxy and CA configuration. Docker commands intentionally ignore inherited
remote Docker contexts/TLS selectors. Ports 54326–54329 bind only to loopback.

Run from the repository root in separate terminals where indicated:

```bash
node scripts/certification/local-stack.mjs up --short-tokens
node scripts/certification/gateway.mjs                    # keep running
node scripts/certification/seed.mjs                       # once per clean DB
node scripts/certification/run-db.mjs
node scripts/certification/api-check.mjs                  # expected FAIL while blocker exists

node scripts/certification/local-stack.mjs app run build
node scripts/certification/local-stack.mjs app run start -- -p 3100 # keep running
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/refresh-check.mjs
# refresh-check changes only this disposable Auth container to standard tokens.
node scripts/certification/workflow-check.mjs
node scripts/certification/metrics-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/browser-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/chart-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/restrictions-check.mjs
NODE_ENV=production node scripts/dashboard-production-check.mjs http://localhost:3100

# Stop the local app before rebuilding its .next directory:
node scripts/certification/standard-checks.mjs
node scripts/certification/export-evidence.mjs
```

Do not run financial/API mutations concurrently with dashboard amount assertions.
The browser password-choice test changes its disposable account's password and
saves it privately. Recreate the stack for an independent complete run. `up`
refuses existing named containers. For a browser-only investigation, the normal
`up` default is a 3600-second JWT; `auth-tokens short|standard` can switch only
the identity-checked, labelled local Auth service. Neither command changes app
authentication or any hosted setting.

`restrictions-check` intentionally locks one synthetic identifier; run it last.
For a targeted browser retry use, for example, `browser-check.mjs super_admin`.
Role-filtered retries perform read/navigation checks and write a separate result
file. `--core-only` runs financial actions and session cases without role screens;
`--sessions-only` and `--logout-only` allow focused session retries. The evidence
exporter merges broad runs first, then focused retries, retaining failed previous
attempts. A retry never turns an untested case into a pass. The browser follows the
actual installation prompt's Not Now action and waits for streamed loading
boundaries, rather than disabling those features or accepting a loading shell.

Credentials and raw artifacts live under ignored `work/isolated-certification/`;
credential files use mode 0600. Never commit or share `state.json`, `accounts.json`,
environment files, cookies or tokens. Use `export-evidence.mjs` to copy sanitized
results and synthetic screenshots into the review documentation.

After stopping the application and gateway, destroy disposable database data:

```bash
node scripts/certification/local-stack.mjs down
```

The database uses tmpfs and is destroyed with its container. `down` removes only
the specifically named containers/network carrying the disposable label; local
private evidence/credential files remain ignored for inspection and may then be
deleted. Existing hosted resources, branches and Vercel configuration are untouched.

## Session configuration and limits

Supabase's [session documentation](https://supabase.com/docs/guides/auth/sessions)
recommends a 3600-second access token and a 10-second refresh-token reuse interval,
with rotation enabled. The upstream GoTrue binary defaults its reuse interval to
zero; this harness sets Supabase's documented 10 seconds explicitly. A deliberate
60-second token mode accelerates the API expiry test and is not recommended for
ordinary app use. PostgREST permits 30 seconds of JWT clock skew, so the expiry
assertion waits beyond that allowance. `refresh-check` signs in through the real
form with a short native token, switches the local issuer to documented defaults,
waits for the original token to expire, and verifies a refreshed SSR session.

Storage uploads/downloads, external email/SMS recovery delivery, provider payment
integration and hosted-project configuration parity are outside this stack.
Unsupported gateway endpoints return 501; they are never counted as passing.
Do not promote fixture previews or these local checks into proof of those flows.
See `docs/release-certification.md` for the release decision and unresolved tests.
