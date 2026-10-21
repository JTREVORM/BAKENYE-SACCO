# Isolated dashboard certification

This tooling never discovers, links or resets a hosted Supabase project. It
generates its own credentials and uses loopback endpoints, a dedicated Docker
network, labelled disposable containers and a private database identity marker.
Mutation runners verify that marker before accessing synthetic records.
Financial functions, role assignments and existing permission predicates are
unchanged. The BKC-01 additive security migration and matching password actions
are exercised by native Auth regression tests; historical migrations are unchanged.

The older `documentation/source/test-stack/gateway.mjs` emulates authentication
and is unsuitable for real session certification. This stack uses **real
GoTrue v2.197.0**, **PostgREST v13.0.7** and **PostgreSQL 16** instead. There is
no Supabase CLI configuration or CI workflow in this repository. All 49 repository
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
node scripts/certification/api-check.mjs
node scripts/certification/password-check.mjs             # BKC-01 native Auth + proof/grant regressions

node scripts/certification/local-stack.mjs app run build
node scripts/certification/local-stack.mjs app run start -- -p 3100 # keep running
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/refresh-check.mjs
# refresh-check changes only this disposable Auth container to standard tokens.
node scripts/certification/workflow-check.mjs
node scripts/certification/metrics-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/browser-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/chart-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/notification-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/password-form-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/collection-check.mjs
NODE_ENV=production node scripts/dashboard-production-check.mjs http://localhost:3100

# Stop the production app, run the existing fixture suites with the same local
# credentials, then stop dev before the final build:
node scripts/certification/local-stack.mjs app run dev -- -p 3100 # keep running
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/preview-checks.mjs
# Stop dev:
node scripts/certification/standard-checks.mjs
# Start the production app again for final changed-component regressions:
node scripts/certification/local-stack.mjs app run start -- -p 3100 # keep running
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/chart-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/notification-check.mjs
NOTIFICATION_RESULT_FILE=notification-repeat-results.json \
  CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/notification-check.mjs
NOTIFICATION_RESULT_FILE=notification-recheck-results.json \
  CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/notification-check.mjs
PASSWORD_FORM_RESULT_FILE=password-form-repeat-results.json \
  CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/password-form-check.mjs
COLLECTION_RESULT_FILE=collection-repeat-results.json \
  CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/collection-check.mjs

# The lockout suite leaves a member identifier paused, so it runs after every
# suite that signs in:
CHROMIUM_PATH=/usr/bin/chromium node scripts/certification/restrictions-check.mjs
node scripts/certification/export-evidence.mjs
```

Do not run financial/API mutations concurrently with dashboard amount assertions.
The browser password-choice test changes its disposable account's password and
saves it privately. Recreate the stack for an independent complete run. `up`
refuses existing named containers and a nonempty private work directory: archive
the previous `work/isolated-certification` directory before a new run so old
results cannot silently enter the next certification. For a browser-only investigation, the normal
`up` default is a 3600-second JWT; `auth-tokens short|standard` can switch only
the identity-checked, labelled local Auth service. Neither command changes app
authentication or any hosted setting.

`notification-check` performs **54 independent interactions**: a member and four
staff roles, each at 390px and 1440px, five attempts apiece, plus a duplicate-tap
refusal and a dropped-request recovery for each area. It never signs in as the
peer account whose notifications it checks stay unread, so it is independent of
the lockout suite. `NOTIFICATION_RESULT_FILE` names its result file, so repeat
runs are kept beside the first rather than overwriting it.

`password-form-check` performs **66 independent checks** of the signed-in
change-password form: **50 wrong-password submissions** (four staff roles and a
member, each at 390px and 1440px, five apiece), then confirmation mismatch,
policy refusal, password reuse, an expired session, a dropped request, an
injected server failure, a duplicate submit, and finally the successful change
with its audit and the retirement of the old password. Every refusal also
re-checks the audit count, the account row and both passwords against Auth.
It changes the `accountant` and `member_a` passwords on success and writes them
back to `accounts.json`, the same way the browser suite does.
`PASSWORD_FORM_RESULT_FILE` names its result file.

`collection-check` performs **102 independent savings collections** by default:
three roles at 390px and 1440px, fifteen apiece, plus a slow answer, three
clicks during one slow request, a lost answer for a posting that happened, a
lost answer for one that never arrived, a refusal and a reload after a confirmed
collection. Every attempt asserts the screen states an outcome, that exactly one
ledger row carries the submission's key, that the reference shown is the
ledger's, and that the balance moved by the amount recorded and no more.
`COLLECTION_ATTEMPTS` sets the repeat count and `COLLECTION_RESULT_FILE` names
its result file. It posts real synthetic savings, so run it before the amount
assertions in `metrics-check` or re-run those after.

`restrictions-check` intentionally locks one synthetic identifier; run it last.
For a targeted browser retry use, for example, `browser-check.mjs super_admin`.
Role-filtered retries perform read/navigation checks and write a separate result
file. `--core-only` runs financial actions and session cases without role screens;
`--sessions-only` and `--logout-only` allow focused session retries. The evidence
runner also accepts `--test='profile password form'` with `--sessions-only` to
repeat a matching session case without rerunning already completed password
choices. A filter matching no checks fails. Run these before the lockout suite;
that suite deliberately leaves its disposable member identifier paused.
The evidence
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
The native recovery-token/password-update API is tested using a disposable admin-
generated recovery link. External email delivery and the emailed PKCE callback
journey remain unverified. Unsupported gateway endpoints return 501; they are never counted as passing.
Do not promote fixture previews or these local checks into proof of those flows.
See `docs/release-certification.md` for the release decision and unresolved tests.
