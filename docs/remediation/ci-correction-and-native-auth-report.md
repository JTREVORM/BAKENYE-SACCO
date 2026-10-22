# CI correction and native Supabase Auth certification

**Two CI failures corrected, and the native GoTrue release gate closed.**

| | |
| --- | --- |
| Correction branch | `fix/ci-corrections-native-auth` |
| Branched from | `fix/frontend-reliability-support` at `a70cac461f0c17ce99445cf4eabef33008030fa7` |
| Failing run addressed | [39789916492](https://github.com/JTREVORM/BAKENYE-SACCO/actions/runs/39789916492) — 2 of 4 jobs failed |
| **Merged** | **No** |
| **Production migrations applied** | **No** |
| **Deployed** | **No** |

Nothing in the Claude backend remediation or the Codex frontend remediation was
changed. The diff touches CI scripts, two test suites and new test tooling only
— no migration, no RLS policy, no permission, no financial rule, no application
code.

---

## A. The two failing jobs

### 1. The detection job could not copy the database

```
ERROR:  source database "budsacco_ci" is being accessed by other users
DETAIL:  There are 2 other sessions using the database.
STATEMENT:  create database budsacco_ci_vuln template budsacco_ci;
```

`CREATE DATABASE … TEMPLATE` requires the source to have no other sessions, and
PostgREST holds a connection pool open. `ci-verify-detection.sh` stopped
PostgREST *after* the copy instead of before it.

**Fixed** by stopping PostgREST — and waiting for the process to actually be
gone, not merely signalled — then terminating any residual backends on the
source, then copying. The copy retries three times, and if it still cannot be
made the job fails with the session list rather than continuing.

The same oversight existed in `ci-db-setup.sh`'s `DROP DATABASE`, where a CI
runner's freshness had been hiding it. Hardened the same way.

### 2. A far more serious problem in the same job

Detection was asserted as:

```bash
if [ "$status" -eq 0 ]; then echo "the check PASSED"; exit 1; fi
echo "✔ the check failed against the restored defect, as it must"
```

**Any** non-zero exit counted as proof that the check detects the vulnerability.
A missing module, a refused connection, a typo in the shell script, an
out-of-disk runner — every one of those exits non-zero, and every one would have
been recorded as "the check detects F-01". The job would have gone green having
proved nothing.

This is not hypothetical: it is exactly what the create-database error was. The
only reason it did not count as proof is that `set -e` killed the script three
lines before the exit-code test.

**Fixed** by asserting detection *by name*:

- `password-security-rest-check.mjs` now gives every assertion a stable id and
  writes a JSON report. `completed: true` is written only by a run that reached
  the end; a crash writes `completed: false` and exits 2.
- `.github/scripts/assert-detection-report.mjs` requires the report to exist, to
  say `completed: true`, the **five** assertions the F-01 defect breaks to have
  all failed, and the **seven** that prove the harness worked to have all
  passed — with set equality, so an assertion cannot quietly appear or vanish
  without someone deciding which list it belongs in.
- The script also verifies the defect really was restored (a flag-clearing
  `log_password_changed()` granted to `authenticated`) before drawing any
  conclusion from its absence.

| | Must fail | Must pass |
| --- | --- | --- |
| | `bypass-refused` | `provisioned` |
| | `lock-holds-after` | `session-locked` |
| | `reads-nothing-after` | `lock-holds-before` |
| | `flag-untouched` | `halves-unreachable` |
| | `no-false-audit` | `issue-retired` |
| | | `credential-untouched` |
| | | `stores-private` |

`credential-untouched` is in the must-pass list deliberately: the bypass has to
lift the lock **without** changing the password. If the credential had changed
too, the run would not be reproducing F-01 at all.

**Checked against five negative cases**, every one of which now fails the job:

| Case | Result |
| --- | --- |
| No report at all (the script crashed) | ✖ "That is not evidence that it detects the vulnerability" |
| Report says `completed: false` | ✖ "its failures are a crash rather than a detection" |
| Harness broken (`provisioned` failed) yet failures exist | ✖ names the broken assertion *and* the wrong failure count |
| A real database connection error inside the check | ✖ no report written |
| The defect not restored, so the check passes | ✖ every must-fail assertion missing |

### 3. The money suite imported a path that exists on no runner

It imported `/var/tmp/bud-docs-stack/money-extract.mjs` — an absolute path to a
hand-made JavaScript **copy** of two functions from `src/lib/money.ts`, left
behind by a local test-stack run.

Two problems, and only the first broke CI. The path does not exist on a fresh
checkout. And it tested a duplicate that nothing kept in step with the
application, so a change to the real money formatting would have left the suite
passing against the old behaviour — the same fault as F-14, in a different
corner.

**Fixed** as `scripts/money.test.mjs` (`npm run test:money`), which transpiles
`src/lib/money.ts` with the repository's own TypeScript dependency and runs the
real module — the pattern `scripts/phone.test.mjs` has always used for
`src/lib/phone.ts`. No generated file, no absolute path, nothing to keep in step
by hand.

All 22 original assertions are preserved, plus one that the application module
really was loaded. **Verified to track the source:** changing the cents cap in
`src/lib/money.ts` from 2 to 3 fails assertion 10; restoring it passes 23. The
stale copy and the old runner are deleted so nothing can point at them again.

---

## B. CI result

| Run | Commit | Result |
| --- | --- | --- |
| [39789916492](https://github.com/JTREVORM/BAKENYE-SACCO/actions/runs/39789916492) | `a70cac4` | 2 of 4 jobs **failed** |
| [39808943154](https://github.com/JTREVORM/BAKENYE-SACCO/actions/runs/39808943154) | `1374509` | **all 4 jobs passed** |

The final run and SHA for this branch are recorded at the end of this document.

All four jobs were also reproduced locally against the same scripts: 52
migrations applying from empty, 513 SQL assertions, 36 phone, 23 money,
typecheck clean, ESLint within budget, build at the unchanged 103 kB shared JS,
and the full `rest-security` job including the detection step.

---

## C. Native Supabase Auth — the release gate is now closed

The previous reports recorded this as an unexecuted blocker:

> *Native Supabase GoTrue is **not available** in this environment. The local
> gateway uses PostgreSQL bcrypt and emulates the Auth API. … native GoTrue
> session rotation, token revocation, refresh/cookie interactions and hosted
> Auth behavior remain **unexecuted release gates**. Emulator success is not
> native GoTrue certification.*

**It is available, and it has now been executed.**

### How

There is no Docker daemon in this environment and GoTrue publishes no binary
this session can reach, but Go 1.24.7 is present and `proxy.golang.org` is
reachable. So `supabase/auth` **v2.197.0** is built from source, and a small
router puts real GoTrue and real PostgREST behind one Supabase-shaped origin:

```
@supabase/supabase-js  ->  router :54321  ->  /auth/v1  ->  real GoTrue  :9999
                                          ->  /rest/v1  ->  real PostgREST :3002
```

`documentation/source/test-stack/native-auth/up.sh` builds it, creates a
disposable database, runs **GoTrue's own migrations** to produce the genuine
`auth` schema (27 tables — `sessions`, `refresh_tokens`, `one_time_tokens`,
`identities`, `mfa_*`), layers the SACCO's 52 migrations and seed on top, and
creates the first administrator **through GoTrue's Admin API** so the SACCO's
provisioning trigger fires from GoTrue's own insert.

Two details were load-bearing and are documented in the stack's README:

- GoTrue must connect as `supabase_auth_admin` with `search_path = auth`, as a
  hosted project runs it. As `postgres` it fails with
  `relation "identities" does not exist`.
- `GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated` is required even though GoTrue
  logs a deprecation notice for it: it is what puts `"role": "authenticated"` in
  the access token, and PostgREST reads that claim to choose a database role.
  Without it every session arrives as `anon` and reads nothing. **The lifecycle
  suite's `jwt-claims` assertion is how that omission was found** — it failed
  rather than passing over a broken configuration.

The stack is also *stricter* than the shared one: the shared bootstrap grants
the API roles `SELECT` on `auth.users` and a real Supabase project does not, so
`up.sh` revokes it.

### What was certified — 40 assertions, all passing

`scripts/native-auth-lifecycle-check.mjs`, evidence in
`docs/remediation/evidence/08-native-gotrue-lifecycle.out`.

| Group | What it now observes rather than models |
| --- | --- |
| **A. Password creation** | The Admin API creates the login, the SACCO trigger links the member and starts it on a forced change, and GoTrue stores a **real bcrypt hash** (`$2a$10$…`, 60 chars) |
| **B. Sessions** | Real GoTrue JWT claims (`sub`, `role`, `aud`, 60-minute `exp`), a recorded `auth.sessions` row and refresh token, and **refresh-token rotation** |
| **C. Forced change under attack** | With a **real** GoTrue access token: the account reads nothing, `log_password_changed()` is refused (42501), neither half of a verified change is reachable, the lock is exactly where it was, and no audit row claims a change |
| **D. Password update** | The bcrypt hash genuinely moves; the lock lifts only then; the change is recorded once; **the old password stops working and the new one works** — only observable with real GoTrue |
| **E. Staff reset (F-04)** | Through the real Admin API, including failure injection (completion refused while nothing was installed, so no false `account.password_reset` row) and abort (prior standing restored, member's own password still works) |
| **F. Recovery** | Real recovery tokens exchange for real sessions — **and a recovery session cannot lift the forced-change lock by any route**, and reads nothing while confined |
| **F. Redirect allow-list (F-03)** | An off-allow-list `redirectTo` is **discarded and replaced by the Site URL**; an allow-listed one survives intact, path and query and all |
| **G. Account standing** | GoTrue admits a suspended member because it knows nothing of SACCO standing; `my_session()` reports the suspension so the application refuses. A deactivated account holds a valid session and still reads nothing |
| **H. Sign-out / lifetime** | Sign-out revokes the refresh token so no new access token can be minted; the already-issued token stays valid until it expires (60 min), which is documented Supabase behaviour and is bounded in the application by the idle-timeout cookie (F-08) |

### It can fail

A passing security suite proves nothing unless it can fail. With the pre-0049
`log_password_changed()` restored, this suite reports **6 failures** — including
`recovery-cannot-unlock` and a recovery-derived session reading **13 records**.
With migration 0049 re-applied, 40/40 again. Evidence:
`09-native-gotrue-detects-defect.out`.

### And it is repeatable

Three consecutive runs, 40/40 each, with the database returning to 12
login-free members every time. Getting there surfaced two real things:

- The suite initially **leaked state** — it deleted the login but left
  `members.user_id` dangling, so the next run failed with *"Member BND… already
  has a login"*. That is the order-dependent, shared-state fault the audit
  recorded as F-13, reintroduced in a new suite. Fixed: the cleanup releases the
  member link and restores member status.
- An account that has **acted cannot be deleted**: `audit_logs.actor_id` is a
  foreign key to `app_users`, so `deleteUser` fails with
  `audit_logs_actor_id_fkey` once the account has any history. That is the
  immutable audit trail doing its job — the SACCO must never lose who did
  something — so the cleanup switches the account off instead of pretending it
  can erase it, and every address the suite creates carries a per-run suffix.

### The browser assertion is executed too

The earlier backend report flagged one thing as added but unrun:

> *The F-01 bypass step was added to `temp-password-check.mjs` and is not yet
> executed.*

It is now, driven through the real application (`next start`) against native
GoTrue: **20/20, 0 problems**. Evidence:
`10-browser-temp-password-native.out`.

Two harness faults were fixed to get there, neither of which changed an
assertion:

- My own added probe opened a *second* browser sign-in and raced the first one's
  in-flight submit. It now asserts the same property on the session already
  open — navigating it rather than signing in again — which is race-free and a
  stronger statement anyway: the bypass attempt did not open the app.
- Two bare `button[type="submit"]` selectors resolved to two elements and
  clicked whichever came first, sometimes one already disabled and `aria-busy`.
  Both are now scoped to their own form and wait for it to be enabled.

---

## D. What is still **not** certified

Stated plainly, because a certification that overstates itself is worse than
none.

### 1. The hosted project's own configuration

This stack proves the **controls work when configured correctly**. It cannot
tell you the SACCO's hosted project is configured that way. Still outstanding,
and still to be checked against the real project:

| Setting | Why it matters |
| --- | --- |
| **Redirect URL allow-list** | The suite asserts GoTrue honours an allow-list, against one set to the site URL only. Whether the hosted project's list is that tight — rather than containing `**` or `http://localhost:3000/**` — is the single check that decides whether **F-03** was ever exploitable. The audit could not read it, and neither can this. |
| Auth rate limits, email templates, JWT expiry, password policy | Project configuration, not code, and not readable from here |
| `prosrc` of `log_password_changed()` on the hosted schema | The release runbook's first step, still unrun |

### 2. F-02 — preview deployments carry production credentials

Unchanged, and still the most serious finding in the system. Every preview
deployment holds an RLS-bypassing key for the live financial database. Needs a
second Supabase project, a re-scope and a key rotation.

### 3. The browser suite is not stable enough for CI

It passes, and it passed six of eight runs during this work. Twice it failed at
the pre-existing step *"a wrong temporary password is refused"* because the
error alert had not rendered inside its 45-second window. GoTrue answers that
request correctly and quickly — its log shows the expected 400 on `/token` — so
the race is in the client render, not in Auth and not in the remediation. The
two selector fixes removed most of it; the remainder belongs to whoever owns the
browser suites. **Until it is gone this suite stays out of CI** rather than
being added as an intermittent job, which is the F-14 mistake wearing a
different costume.

### 4. The native stack is not in CI either

The GoTrue build takes several minutes and the stack has more moving parts than
the other four jobs. It is run deliberately, before a release, and its output is
attached as evidence. Adding it is a reasonable follow-up; doing it badly would
be worse than not doing it.

---

## E. Release position

**The native GoTrue blocker is closed.** Password creation, updates, forced
changes, staff resets, sessions, refresh rotation, sign-out and recovery
restrictions have all been exercised against the real Supabase Auth server in a
fully isolated environment, and the suite that says so has been shown to fail
when the control is broken.

**The release is not unblocked**, and this document does not claim full
authentication certification of the *deployed system*. Two gates remain, and
neither is a software defect:

1. **F-02** — production and preview share RLS-bypassing credentials.
2. **The hosted project's configuration has not been read** — above all the
   redirect allow-list that decides F-03, and the one read-only query
   confirming F-01 is live on the hosted schema before migration 0049 is
   applied.

Both are listed in `release-runbook.md`, and both need someone with access to
the SACCO's Supabase and Vercel projects. Until they are done, what has been
certified is the code and the controls — not the deployment.

---

## F. Isolation

No production or preview database, deployment, credential or configuration was
read or changed. Everything ran against local PostgreSQL on `127.0.0.1`, a
GoTrue built from source, a local PostgREST, and databases these scripts create
and drop. The JWT secrets are generated per run. Every account is synthetic,
created and cleaned up by the suites, and the native suite refuses to start
without `NATIVE_AUTH_ALLOW_WRITES=1` confirming the database is disposable. No
plaintext password appears in any committed file.
