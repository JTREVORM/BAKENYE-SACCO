# Release runbook — security and reliability remediation

**Closes F-12. Nothing in this runbook has been performed. It is the procedure
for the people who will perform it, and every step that touches production is
written for a human with the authority to do it.**

| | |
| --- | --- |
| Release | Backend security and reliability remediation (F-01 … F-19) |
| Branch | `claude/happy-knuth-y3gay4` |
| Migrations | `0049`, `0050`, `0051`, `0052` |
| Application changes | authentication, session, register reporting, CSP, maintenance gate |
| Production state at time of writing | `main` = `0cf56aba7d22bc946128fb9bd20ebe7b80ff39c4`, deployment `dpl_FTs6BNRW1cG69e9sm6n94aaonw1o` |

---

## 0. The two facts that shape this release

**Vercel does not deploy `main`.** `vercel.json` disables Git deployments for
`main`, so merging changes nothing in production. Somebody must promote a
deployment by hand. Until they do, production stays as it is while the
repository looks fixed — which is exactly the trap F-12 was recorded to avoid.

**Vercel does not apply migrations.** The database changes are a separate
action against the Supabase project, performed by a named person, in a defined
order relative to the deployment.

So this release is two coordinated acts, not one, and the order matters.

### Why migrations go first

Every migration in this release is **backward compatible with the application
currently in production**:

| Migration | Does the deployed `0cf56ab` application still work? |
| --- | --- |
| `0049` verified password changes | **Partly, and in the safe direction.** `log_password_changed()` becomes a raising stub, so on the old code a password change still changes the credential through Supabase Auth but no longer lifts the forced-change lock. The holder stays on "Choose your password". Staff resets fail outright (`issue_temporary_password()` also raises). Nobody is locked out of an account they already use, and no account is opened by a credential somebody else was shown. |
| `0050` submission status lookup | Yes. Purely additive. |
| `0051` register totals and index | Yes. Purely additive. |
| `0052` retire dead role helpers | Yes. Nothing calls them; the migration refuses to run if anything does. |

The window between the migration and the promotion is therefore a window in
which **first-login password changes and staff password resets do not complete**.
That is a service interruption, not a security hole, and it is the right way
round: the alternative ordering leaves F-01 open while the new application waits
for functions that do not exist yet.

**Keep that window short — minutes — and run it outside counter hours.**

---

## 1. Before the day

- [ ] **Read the audit.** `docs/audits/full-system-diagnostic-2026-10-22.md`.
- [ ] **Read the remediation report.** `docs/remediation/backend-remediation-report.md`,
      especially *Remaining risks* and *Required production environment changes*.
- [ ] **Confirm F-01 is live on the hosted schema.** One read-only query, and
      the only thing in this release that needs to be checked against production
      before changing anything:

      ```sql
      select prosrc like '%must_change_password = false%' as defect_present
        from pg_proc where proname = 'log_password_changed';
      ```

      `true` means the bypass is live. If it comes back `false`, **stop** and
      find out why — the schema is not what the migration chain implies, and
      `0049` should not be applied until that is understood.

- [ ] **Decide the environment variables** (§2). Two of them must be set *in the
      same build* that gets promoted, because they are inlined at build time.
- [ ] **Agree the people.** Name them, in writing, before the day:

      | Role | Who | Does |
      | --- | --- | --- |
      | Release owner | | decides go / no-go, calls the rollback |
      | Database operator | | takes the backup, applies the migrations |
      | Deployment operator | | promotes the Vercel deployment |
      | Verifier | | runs §6, and is **not** one of the two operators |

- [ ] **Agree the window.** Outside counter hours. Nobody mid-registration,
      nobody mid-collection.
- [ ] **Tell the SACCO staff** that first-login password changes and password
      resets will be briefly unavailable, and that self-service "Forgot
      password" is being withdrawn for good as of this release (§7).
- [ ] **CI is green** on the branch (`.github/workflows/ci.yml`, all four jobs).

---

## 2. Production environment variables

Set these on the Vercel **production** target. Two of them are
`NEXT_PUBLIC_`, which means they are inlined into the build — setting them is
not enough, the build that carries them must be the one promoted. So set them
**before** triggering the build in §5.

| Variable | Value | Why | Required? |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://www.bakenye-sacco.online` | F-03. Removes any chance of a link host being taken from a request header. This release removes the one code path that read the `Origin` header, so this is now defence in depth rather than the fix — but `siteUrl()` throws in production when it is unset, so **set it or the build will fail at runtime** wherever a link host is needed. | **Yes** |
| `MAINTENANCE_BYPASS_TOKEN` | ≥ 16 characters, randomly generated — `openssl rand -base64 32` | F-10. Without it, switching maintenance mode on used to return 503 to everybody including the maintainer. This release makes the gate refuse to close rather than lock everyone out, so the failure is no longer an outage — but the token is what makes maintenance mode *usable*. | Before maintenance mode is ever used |
| `CSP_MODE` | leave **unset** for this release | F-09. Unset means `Content-Security-Policy-Report-Only`: the browser reports what the policy would block and blocks nothing. | No |

Do not change `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` or
`MAINTENANCE_MODE` as part of this release.

**F-02 is not addressed by this release and is not addressed by this runbook.**
The service-role key and database URL are still scoped to `production` and
`preview`, so every preview deployment still carries RLS-bypassing credentials
for the live database. It needs a second Supabase project, a key rotation and a
redeploy, and it is a larger change with its own risk. It remains the most
serious outstanding infrastructure finding. See the remediation report.

Record the bypass URL where the people who would need it can find it without
this repository:

```
https://www.bakenye-sacco.online/maintenance-bypass?token=<MAINTENANCE_BYPASS_TOKEN>
```

It grants sight of the sign-in screen and nothing more; everything past it still
needs a real session and RLS still decides every row.

---

## 3. Back up the database — not optional

The Supabase Free tier provides no managed point-in-time recovery, so this
backup is the only way back from a migration that goes wrong. See
`docs/remediation/backup-and-restore.md` for the procedure and, more
importantly, for the **restore rehearsal** that proves the backup is real.

- [ ] Take a fresh `pg_dump` immediately before applying anything.
- [ ] Record its size, its SHA-256, and where it is stored.
- [ ] **Restore it into a throwaway database and check the figures match.**
      A backup nobody has restored is a hope, not a backup.

```bash
# From a machine that can reach the project. The dump contains real member
# data: encrypt it, store it off-site, and do not leave it on a laptop.
pg_dump --no-owner --no-privileges --format=custom \
        --file="bnd-pre-0049-$(date +%Y%m%d-%H%M).dump" "$PRODUCTION_DATABASE_URL"
```

- [ ] Note the current production deployment ID, so §8 knows what to roll back
      to. At the time of writing: `dpl_FTs6BNRW1cG69e9sm6n94aaonw1o` at `0cf56ab`.
- [ ] Confirm the two most recent production deployments are still marked
      rollback candidates.

---

## 4. Apply the migrations

In this order, one at a time, checking each before starting the next. They are
written to be safely re-appliable, so an interrupted run can be retried — CI
asserts that.

```bash
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0049_verified_password_changes.sql "$PRODUCTION_DATABASE_URL"
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0050_submission_status_lookup.sql  "$PRODUCTION_DATABASE_URL"
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0051_register_totals_and_scale.sql "$PRODUCTION_DATABASE_URL"
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0052_retire_dead_role_helpers.sql  "$PRODUCTION_DATABASE_URL"
```

Notes on each:

- **`0049`** creates the `password_security` schema. On a hosted project it runs
  as `postgres`, which owns it. Nothing in `anon`, `authenticated` or
  `service_role` can reach it afterwards; `0049` revokes explicitly.
- **`0051`** creates an index on `transactions`. On a large table
  `CREATE INDEX` takes a lock. Consider `create index concurrently` instead if
  the table is big enough to matter — it cannot run inside the migration's
  transaction, so it would be a separate statement run outside it. At the
  SACCO's current size this is unlikely to be necessary.
- **`0052`** refuses to run if anything still references `has_role()` or
  `assert_role()`. If it raises, **do not force it** — something on the hosted
  schema differs from the migration chain, and that is worth understanding
  before removing an authorisation helper.

Then check, before going near Vercel:

- [ ] F-01 is closed:

      ```sql
      select
        (select prosrc like '%raise exception%' from pg_proc where proname = 'log_password_changed') as retired,
        has_function_privilege('authenticated','public.log_password_changed()','execute') as still_callable,
        has_function_privilege('authenticated','public.begin_password_change(uuid)','execute') as begin_callable;
      -- expect: retired = true, still_callable = false, begin_callable = false
      ```

- [ ] The new functions exist and are granted as intended:

      ```sql
      select p.oid::regprocedure::text,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
             has_function_privilege('service_role',  p.oid, 'execute') as service_role
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('begin_password_change','complete_password_change',
                           'begin_temporary_password_reset','complete_temporary_password_reset',
                           'abort_temporary_password_reset','submission_status',
                           'member_register_totals')
       order by 1;
      -- expect: the two *_password_change halves authenticated = false, service_role = true
      --         the three reset steps and the two readers authenticated = true
      ```

- [ ] The dead helpers are gone, and roles and permissions are untouched:

      ```sql
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('has_role','assert_role');   -- expect 0
      select count(*) from roles;                                                -- expect 9
      select count(*) from permissions;                                          -- expect 39
      ```

- [ ] Nothing moved in the books. Run the audit's own invariant queries
      (`docs/audits/evidence/03-accounting-invariants.sql`) and confirm they all
      still hold. **None of these migrations touches a financial record**, so
      any change here means stop.

---

## 5. Build and promote

- [ ] Confirm §2's environment variables are set on the production target
      **now**, before the build.
- [ ] Trigger a production build from the release commit. Git deployment is
      disabled for `main`, so this is a deliberate action — the Vercel
      dashboard, or `vercel --prod`.
- [ ] Check the build log: it must succeed, and the shared JS should be around
      103 kB. A large jump means something unintended was pulled in.
- [ ] Promote it.
- [ ] Confirm the live deployment's commit SHA is the release commit. Not "a
      recent one" — exactly the one. The audit verified this match on the
      previous release and it is worth keeping as a habit.

---

## 6. Verify — by somebody who did not do the work

Run against production, with a real but **synthetic or consenting** test
account. **No real member's password is reset for this.**

### Authentication

- [ ] A normal sign-in works, for a member and for staff, and lands on the right
      dashboard.
- [ ] An officer resets the test account's password. The temporary password is
      shown once. The audit log shows `account.password_reset`.
- [ ] Signing in with it goes to "Choose your password", and every other route
      bounces back there.
- [ ] Choosing a new password lands on the dashboard, and the records open up.
- [ ] The old temporary password no longer works; the chosen one does.
- [ ] **The F-01 bypass is closed.** With a bearer token for an account on a
      temporary password:

      ```
      POST /rest/v1/rpc/log_password_changed   → 403/404, not 204
      GET  /rest/v1/transactions               → still []
      ```

      This is the whole point of the release. Check it, do not assume it.
- [ ] "Forgot password" shows the contact-support page and sends no email.
- [ ] Signing out leaves no protected page reachable with Back.

### Money — read, do not write

- [ ] A member's savings, shares and loan balance read the same as before the
      release. **Compare against figures written down in §3.**
- [ ] A receipt renders and prints to one A4 page.
- [ ] The member register loads; its totals match a direct database sum.
- [ ] The CSV download completes and its row count equals the member count.
- [ ] One existing transaction's detail page and receipt are unchanged.

Only once the above is clean, and only if the SACCO wants it verified end to
end, record **one** synthetic collection against a test member and reverse it,
confirming the till returns to its exact prior balance.

### Infrastructure

- [ ] `curl -sI https://www.bakenye-sacco.online/login | grep -i content-security`
      shows `content-security-policy-report-only`, **not** the enforcing header.
- [ ] With DevTools open, walk sign-in, a receipt, a print preview and the
      register, and collect the CSP violation reports. File them; they are the
      input to the decision about `CSP_MODE=enforce` in a later release.
- [ ] `MAINTENANCE_MODE` is still off and the site serves normally.

---

## 7. Tell people

- [ ] **Staff:** self-service "Forgot password" is withdrawn. A member who has
      forgotten their password must come to the office and be identified; an
      officer resets it and hands over the temporary password. The member must
      change it at their next sign-in — and now genuinely must, because the
      lock can no longer be lifted without changing the password.
- [ ] **Staff, security briefing:** a temporary password is a credential two
      people know. Hand it over in the member's presence and have them change it
      there and then. Before this release, the window never closed.
- [ ] **The committee:** F-02 is still open, and the backup position (§3 and the
      recovery document) is a business-continuity decision they need to make.

---

## 8. If it goes wrong

Decide what broke before acting, because the two layers roll back differently.

### The application is broken, the database is fine

Roll back the deployment. Fastest path, and the migrations are backward
compatible with `0cf56ab` as §0 describes.

- [ ] Promote the previous production deployment (`dpl_FTs6BNRW1cG69e9sm6n94aaonw1o`).
- [ ] Expect first-login password changes and staff resets to fail on the old
      code — that is §0's known window, and it is now open-ended. Treat the
      release as unfinished and fix forward promptly rather than sitting in it.

### A migration is the problem

Prefer forward recovery. These are small, well-understood changes, and a
restore throws away every transaction the SACCO has posted since the dump.

- [ ] `0052` broke something → restore the two helpers from migration `0002`.
      Nothing calls them, so this is safe.
- [ ] `0051` broke something → `drop index transactions_member_status_type_idx;`
      and `drop function member_register_totals(member_status);`. Both additive.
- [ ] `0050` broke something → `drop function submission_status(text);`. Additive.
- [ ] `0049` broke something → this is the one that matters. **Do not restore the
      old `log_password_changed()` to "fix" a password problem** — that
      re-opens F-01. Roll the application back instead (§8.1) and diagnose with
      the lock in place.

### Only a full restore will do

- [ ] Switch on maintenance mode **with the bypass token set**, so the SACCO
      sees a proper page and the operator can still reach the application.
- [ ] Restore the §3 dump into a **new** database first and check it. Never
      restore over the live one as the first attempt.
- [ ] Accept, explicitly and in writing, that every transaction posted since the
      dump is gone, and plan how they will be re-entered from the counter
      records.
- [ ] Roll the deployment back to match.

Log every step with its time. If the release is abandoned, say so plainly to
staff and record what state production was left in.

---

## 9. After

- [ ] Record the deployment ID, the commit SHA, the time each migration was
      applied, and who did what.
- [ ] Keep the backup for at least 30 days.
- [ ] Open the follow-ups the remediation report lists as remaining risks —
      **F-02 first.**
- [ ] Schedule the restore rehearsal if it has not been done.
- [ ] Review the CSP violation reports and decide whether the next release sets
      `CSP_MODE=enforce`.
