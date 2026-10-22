# Native Supabase Auth test stack

A fully isolated stack running the **real** Supabase Auth server (GoTrue), so
the authentication lifecycle can be certified against the thing that actually
holds the SACCO's passwords rather than an imitation of it.

**Test tooling. Never deployed, never pointed at a hosted project.**

---

## Why this exists

The audit and the first remediation left one gap open, and it was recorded as a
release blocker rather than papered over:

> *Native GoTrue password lifecycle (real bcrypt, real `updateUser`) — the
> disposable stack's auth is Supabase-shaped but not GoTrue. The SQL and REST
> tests model the credential change by writing `auth.users.encrypted_password`
> directly.*

`../gateway.mjs` **imitates** GoTrue: it mints its own JWTs, hashes its own
passwords, and implements the slice of the auth API this application happens to
call. That is enough to drive the application, and it is what the earlier
certification ran against — but it cannot certify Supabase Auth, because it is
not Supabase Auth. Anything resting on GoTrue's real behaviour was modelled:

- that a password is hashed and verified by GoTrue's own bcrypt;
- that an old password genuinely **stops working** after a change;
- that tokens are real GoTrue JWTs, with real sessions and refresh rotation;
- that recovery tokens are real, and that the redirect allow-list bites;
- that a staff reset really installs a credential through the Admin API.

This stack closes that gap. `@supabase/supabase-js` cannot tell it from a hosted
project, which is the point: the lifecycle suite drives the same client the
application does.

---

## What it is made of

| Piece | What it is |
| --- | --- |
| PostgreSQL | a database `up.sh` drops and recreates on every run |
| **GoTrue** | the real `supabase/auth` binary, built from source by `build-gotrue.sh` |
| PostgREST | the real PostgREST, sharing GoTrue's JWT secret so its tokens validate |
| `supabase-router.mjs` | one Supabase-shaped origin: `/auth/v1/*` → GoTrue, `/rest/v1/*` → PostgREST. A proxy and nothing else — it mints no tokens and makes no decisions, so nothing it does can make a test pass that would fail against a real project |

GoTrue is built rather than pulled because this environment has a Docker client
but no daemon. It is a Go program with no CGO, so `go build` yields a single
static binary; the dependency tree is large, so the first build takes a few
minutes and is then cached at `/var/tmp/auth-src/auth`.

---

## Running it

```bash
bash documentation/source/test-stack/native-auth/up.sh
# then paste the exported environment it prints, and:
node scripts/native-auth-lifecycle-check.mjs
```

It needs a local PostgreSQL 16 on port 54322 and the PostgREST binary the main
test stack uses (`/var/tmp/bud-docs-stack/postgrest`).

### The order matters

GoTrue **owns** the `auth` schema and runs its own migrations, so it goes first.
Then the shared `00_bootstrap.sql` adds the API roles and the
PostgREST-compatible `auth.uid()` / `auth.role()` helpers — its
`create table if not exists auth.users` becomes a no-op against GoTrue's real
table, which is exactly what we want. Then the SACCO's own 52 migrations and
seed.

GoTrue connects as `supabase_auth_admin` with `search_path = auth`, owning the
auth schema, because that is how a hosted Supabase project runs it. Connecting
as `postgres` fails with `relation "identities" does not exist` — the schema is
there, but not on the search path.

### Two configuration details that are load-bearing

- **`GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated`** is required even though
  GoTrue logs a deprecation notice for it. It is what puts `"role":
  "authenticated"` in the access token, and PostgREST reads that claim to choose
  a database role. Without it every session arrives as `anon` and reads nothing.
  The lifecycle suite's `jwt-claims` assertion catches this rather than passing
  over it — it is how the omission was found.
- **`GOTRUE_URI_ALLOW_LIST`** is set to the site URL only. That is the control
  F-03 turned on, and the suite asserts it both ways (see below).

### Stricter than the shared stack, on purpose

`00_bootstrap.sql` grants the API roles `SELECT` on `auth.users`; a real
Supabase project does not. `up.sh` revokes it, so this stack is faithful rather
than convenient.

---

## What the lifecycle suite certifies

`scripts/native-auth-lifecycle-check.mjs` — 40 assertions in eight groups.

| Group | Covers |
| --- | --- |
| A | Password creation: provisioning through the Admin API, the SACCO trigger linking the member, a real bcrypt hash |
| B | Sessions: real JWT claims, a recorded `auth.sessions` row, refresh-token rotation |
| C | The forced-change lock attacked with a **real** GoTrue token (F-01) |
| D | The verified change ceremony: the hash really moves, the lock lifts only then, the **old password stops working** |
| E | Staff-assisted reset through the real Admin API, including the failure-injection and abort paths (F-04) |
| F | Recovery: real recovery tokens, that a recovery session **cannot** lift the lock, and the redirect allow-list (F-03) |
| G | That account standing is the SACCO's and not GoTrue's — suspended and deactivated accounts |
| H | Sign-out and token lifetime, observed rather than assumed |

### It can fail

A passing security suite proves nothing unless it can fail — the audit's F-14
finding. With the pre-0049 `log_password_changed()` restored, this suite
reports **6 failures**, including a recovery-derived session reading 13 records.
With the fix back, 40/40. See
`docs/remediation/evidence/09-native-gotrue-detects-defect.out`.

### Two things it deliberately does **not** claim

- **It is not the hosted project.** The redirect allow-list is asserted against
  *this* stack's `GOTRUE_URI_ALLOW_LIST`. Whether the SACCO's hosted project has
  a tight allow-list is a separate check against that project, and it is still
  outstanding.
- **It is not in CI.** The GoTrue build takes several minutes and the stack has
  more moving parts than the other jobs. It is run deliberately, before a
  release, and its output is attached as evidence.

---

## Isolation

Every connection string is `127.0.0.1`. The JWT secret is generated per run.
No value from any hosted project is read, and the suite refuses to start unless
`NATIVE_AUTH_ALLOW_WRITES=1` confirms the database is disposable. Every account
it touches it creates, and deletes again. No production or preview credential
is involved at any point.
