# Evidence — backend security and reliability remediation

Raw output from the verification runs behind
`docs/remediation/backend-remediation-report.md`. Nothing here was produced
against the SACCO's hosted Supabase project, its live data, or its production
deployment.

## Where it ran

A disposable, offline stack, built for this work and thrown away with the
session:

- PostgreSQL 16.15, a fresh local cluster on port 54322, timezone
  `Africa/Kampala`, with all 52 migrations applied in order from empty plus the
  repository's own `supabase/seed.sql` synthetic data, through the
  Supabase-compatible bootstrap at `documentation/source/test-stack/`.
- PostgREST 12.2.3 — the same version the audit used — in front of that
  database, so the REST boundary tests exercise a real API rather than a
  simulation of one.
- Four separate databases, so no test could contaminate another:
  `budsacco_clean` (the suites), `budsacco_rest` (the REST checks),
  `budsacco_vuln` (the defect deliberately restored, then dropped), and
  `budsacco_scale` (3,012 synthetic members / 300,143 synthetic transactions,
  for the performance measurements).

Every account, member and transaction created by these runs is synthetic. No
real member record was read, written or exported, and no plaintext password
appears in any file here.

## Index

| File | What it shows |
| --- | --- |
| `01-npm-audit-before.json` | Dependency advisories before any change: 14 (11 high, 3 moderate) |
| `02-npm-audit-after.json` | After the non-breaking fixes: 11 (8 high, 3 moderate), all build-time only |
| `03-f01-rest-boundary.out` | F-01 over real HTTP through PostgREST: the bypass is refused and the lock holds — 12/12 |
| `04-f01-rest-detects-defect.out` | **The same check against the defect deliberately restored: 5 failures.** This is what proves the test can fail when the control is broken (F-14) |
| `05-suite-detects-defect.out` | The SQL suite the same way round: 41 pass / 0 fail on the fixed schema, 8 failures on the vulnerable one |
| `06-sql-suites.out` | All 12 SQL suites: 513 assertions, 0 failures |
| `07-performance.out` | F-06 measured at scale, before and after the index, and F-05's totals reconciling exactly |

## The two files worth reading first

`04-f01-rest-detects-defect.out` and `05-suite-detects-defect.out`.

The audit's F-14 finding was not that a test was missing. It was that a
dedicated temporary-password suite passed 16/16 while the bypass stood wide
open, because the suite never attempted the bypass — a security control covered
by a test that could not fail when the control was broken. A green result from
the new tests would mean nothing on its own.

So the defect was put back on a throwaway copy of the database and both new
suites were run against it. Both fail, and they fail with the audit's own
numbers: `POST /rpc/log_password_changed` returning HTTP 204, the flag cleared,
15 transactions and 1 member record becoming visible, and one audit row falsely
claiming the holder had chosen their own password. Against the fixed schema the
same calls return HTTP 403 / SQLSTATE 42501 and nothing opens.

That pairing — passes on the fix, fails on the defect — is the claim. The CI
workflow runs both directions on every push, so a future change that quietly
re-opens the hole, or that declaws the test, fails the build.
