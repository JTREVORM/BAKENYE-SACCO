# Local test stack

A throwaway, offline copy of everything the application needs, so the SQL
suites, a clean-installation test and the browser workflows can all be run
without a hosted Supabase project — and without ever pointing at the SACCO's
live data.

**This is test tooling. It is not part of the application and is never deployed.**

| File | What it is |
| --- | --- |
| `00_bootstrap.sql` | The parts of a Supabase project the migrations depend on: the `auth` schema, `auth.users`, `auth.uid()/jwt()/role()`, and the `anon` / `authenticated` / `service_role` / `authenticator` roles |
| `01_storage.sql` | The `storage.buckets` and `storage.objects` tables migration `0027` writes its bucket policy against |
| `gateway.mjs` | A small service answering the slice of the Supabase API this application calls: GoTrue-shaped auth, a proxy to PostgREST, and Storage (upload, signed links, download) |
| `postgrest.conf` | PostgREST pointed at the local database |
| `clean-install.sh` | Empty database → every migration → first administrator → seed, then reports what the result holds |

## Running it

```bash
# 1. a local PostgreSQL 16 on port 54322, then:
psql "$DATABASE_URL" -f 00_bootstrap.sql
psql "$DATABASE_URL" -f 01_storage.sql
for f in ../../../supabase/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done

# 2. PostgREST and the gateway
./postgrest postgrest.conf &
JWT_SECRET=... DATABASE_URL=... node gateway.mjs &

# 3. the application, against the gateway
#    .env.local: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
npm run dev
```

The gateway prints the anon and service-role keys it will accept on startup;
they are JWTs signed with `JWT_SECRET`, which is also what PostgREST verifies.

## Running the checks

```bash
bash clean-install.sh                                   # clean installation
PGSSLMODE=disable DATABASE_URL=... node ../../../scripts/test-db.mjs   # SQL suites
```

`PGSSLMODE=disable` is needed because the repository's scripts require TLS,
which a hosted Supabase provides and a local Postgres does not.

The money-formatting checks used to live here, alongside a hand-made copy of
two functions from `src/lib/money.ts`. They are now `scripts/money.test.mjs`
(`npm run test:money`), which transpiles the real module the way
`scripts/phone.test.mjs` always has - so there is no copy to keep in step, and
nothing in CI depends on a file this directory happened to leave behind.

## What it is not

It implements only what this application uses. It is not a Supabase
replacement, it has no rate limiting, no email delivery, and its Storage keeps
objects as files on local disk. Its only purpose is to let the application, its
migrations and its test suites be exercised honestly before anything reaches a
real project.
