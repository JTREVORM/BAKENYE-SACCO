# Audit evidence — full system diagnostic, 22 October 2026

Supporting evidence for
[`../full-system-diagnostic-2026-10-22.md`](../full-system-diagnostic-2026-10-22.md).

**Every artefact here was produced against a disposable, offline stack built for
the audit. None of it touched the SACCO's hosted Supabase project, and no
production data, deployment or configuration was changed.** The only exception is
`18-production-readonly.out`, which records unauthenticated HTTP GET/HEAD
requests to public paths on the live site, plus deployment and
environment-variable *metadata* read through the Vercel API — no
environment-variable value was decrypted.

## The stack these results came from

| Component | What it was |
| --- | --- |
| Database | A fresh local PostgreSQL 16.15 cluster, created for this audit and discarded after |
| Schema | All 48 migrations from `supabase/migrations/`, applied in order to an empty database |
| Data | **Synthetic only** — the repository's own `supabase/seed.sql`, plus test accounts created for specific probes |
| Supabase stand-in | The repository's `documentation/source/test-stack/` bootstrap, with PostgREST 12.2.3 and `gateway.mjs` serving a Supabase-shaped HTTP API on `127.0.0.1:54321` |
| Application | The real Next.js app at `0cf56ab`, run both as `next dev` and as a real production build (`next build` + `next start`), pointed at that gateway |
| Browser | Chromium via Playwright |

Accounts used were all synthetic: one super admin, one cashier, three member
logins, and one member deliberately left on a temporary password for the F-01
reproduction.

## Files

| File | What it shows |
| --- | --- |
| `01-bkc01-proof.sql` · `.out` | **F-01 (CRITICAL)** at SQL level: the forced-change lock cleared with no password change; data visibility 0 → 15 rows; `auth.users.encrypted_password` provably untouched; the audit log falsely recording "Changed their password" |
| `02-bkc01-end-to-end-rest.out` | **F-01 reproduced end to end over the real REST API** — sign in on the temporary password, one `POST /rest/v1/rpc/log_password_changed`, then read member transactions, then sign in again with the same temporary password |
| `03-accounting-invariants.sql` · `.out` | 13 accounting-invariant and reconciliation checks — all held |
| `04-concurrency-tests.mjs` · `.out` | 6 adversarial financial tests with genuinely concurrent sessions: same-key double tap, retried submission, identical-payment-different-key, 12 concurrent postings to one account, concurrent double reversal, concurrent loan overpayment — all passed |
| `05-authorization-matrix.mjs` · `.out` | 9 real role identities × 20 probes over sensitive RPCs and RLS-protected tables, plus cross-member isolation |
| `06-loan-rls-verification.out` | Loan visibility checked row by row against `loan_guarantors` — confirms the guarantor rule of migration `0042`, and rules out an RLS leak I had initially suspected |
| `07-sql-suites.out` | The repository's 11 SQL suites: **471 assertions, 471 passed, 0 failed** |
| `08-responsive-dom-audit.out` | Real rendered DOM geometry at 320/360/375/390/430/768/1024/1440/1920px — no horizontal overflow anywhere; the 18 sub-44px tap targets and 5 nine-pixel text runs of **F-16** |
| `09-receipt-and-print.out` | Receipt and print suites: 13 transaction categories, reversed/reversal states, long names, missing values, 6 payment methods, 22 A4 PDF cases, 194 layout + 320 field checks |
| `10-ui-suites.out` | Dashboard accessibility, member, staff, overview and super-admin responsive suites |
| `11-access-and-temp-password.out` | Route access matrix for staff and member; the temporary-password suite passing 16/16 — **the suite whose blind spot is F-14** |
| `12-finance-fees-expenses.out` | Every staff finance route, membership-fee workflows, and the full expense lifecycle including approval posting the exact amount |
| `13-numbering-accounts-pwa.out` | 480 document numbers issued from 24 concurrent connections (all distinct, contiguous); receiving-account behaviour; PWA installability |
| `14-unit-suites.out` | Unit suites as first run — **includes three failures that were artefacts of my own harness**, kept deliberately |
| `15-unit-suites-corrected.out` | The same suites after correcting the harness: money 22/22, maintenance 9/9 |
| `16-query-plans.out` | `EXPLAIN ANALYZE` and index coverage: every foreign key indexed, every table indexed, and the `member_financials` scan shape behind **F-06** |
| `17-npm-audit.json` | Full dependency advisory report — 14 advisories (11 high, 3 moderate) across 448 packages (**F-11**) |
| `18-production-readonly.out` | Read-only observation of the live site: headers, route guards, no secret leakage |
| `19-typecheck.log` · `20-lint.log` | `tsc --noEmit` clean; ESLint one unused-import warning |
| `21-ledger-balance-after-ordering.sql` · `.out` | **F-15**: 140 of 164 ledger entries out of date order, and `balance_after` visibly falling across three successive money-*in* entries |

## Reproducing any of this

```bash
# 1. a throwaway PostgreSQL 16, then:
psql "$DB" -f documentation/source/test-stack/00_bootstrap.sql
psql "$DB" -f documentation/source/test-stack/01_storage.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 "$DB" -f "$f"; done
# provision the first administrator (see documentation/source/test-stack/clean-install.sh)
psql "$DB" -f supabase/seed.sql

# 2. the SQL suites
PGSSLMODE=disable DATABASE_URL="$DB" node scripts/test-db.mjs

# 3. the audit's own probes
psql "$DB" -f docs/audits/evidence/01-bkc01-proof.sql          # F-01
psql "$DB" -f docs/audits/evidence/03-accounting-invariants.sql # invariants
node     docs/audits/evidence/04-concurrency-tests.mjs          # concurrency
node     docs/audits/evidence/05-authorization-matrix.mjs       # authorization
```

The three `.mjs` probes expect the database on `127.0.0.1:55432/budsacco_clean`;
edit the `URL` constant at the top of each to point elsewhere. They need `pg`,
so run them with the repository's `node_modules` resolvable.

**`01-bkc01-proof.sql` demonstrates a live vulnerability. Run it only against a
disposable database.** It rolls back everything it does, but it must never be
pointed at the SACCO's project.
