# Backup and tested restore — Supabase Free tier

**The audit called the backup position "the single largest *business* risk in
this report, even though it is not a software defect." This is the procedure
that answers it. Nothing here has been run against the SACCO's project, and no
production data has been exported in producing it.**

---

## 1. What the tier gives you, and what it does not

Supabase's Free tier does not include the managed scheduled backups or
point-in-time recovery of the paid tiers. For a system holding real member
savings, shares and loan balances, that means:

- there is no automatic copy of the SACCO's financial records to fall back on;
- there is no "restore to 14:35 yesterday";
- and the repository contained no backup tooling and no restore procedure.

The SACCO's records are immutable by design — transactions and ledger entries
cannot be altered or deleted, and a correction is a reversal that leaves both
rows in place. That is excellent for *integrity*. It does nothing for
*availability*: it does not protect against a dropped table, a bad migration, an
accidental project deletion, or losing access to the project altogether.

**This is a committee decision before it is a technical one.** Two honest
options:

| Option | What it costs | What it gives |
| --- | --- | --- |
| **A. Move to a tier with PITR** | a monthly fee | managed backups, point-in-time recovery, and nobody has to remember anything |
| **B. Scheduled `pg_dump`, stored off-site, with a rehearsed restore** | somebody's time, every week, for ever | a copy that is exactly as good as the last time somebody proved it restores |

Option A is what I would recommend for a SACCO holding members' money. The fee
is small against the cost of re-entering a month of transactions from counter
records — or being unable to. Option B is real and workable, but it depends on a
person remembering, and on the restore having been tested; an untested dump is a
hope.

Either way, **do option B's restore rehearsal at least once.** Even on a paid
tier, a restore nobody has performed is a procedure nobody knows.

---

## 2. Taking a backup

Run from a machine that can reach the project, by a named person, with the
production connection string in the environment and not in shell history.

```bash
# Schema and data, in PostgreSQL's custom format so pg_restore can be selective.
# --no-owner / --no-privileges so it restores into a fresh project cleanly.
STAMP=$(date +%Y%m%d-%H%M)
pg_dump --no-owner --no-privileges --format=custom \
        --file="bnd-sacco-${STAMP}.dump" "$PRODUCTION_DATABASE_URL"

# The auth schema holds the logins. pg_dump of the application database includes
# it only if the role you connect as can read it; check, because a restore
# without auth.users is a database nobody can sign in to.
pg_restore --list "bnd-sacco-${STAMP}.dump" | grep -c 'SCHEMA - auth'
```

Then, every time, without exception:

```bash
sha256sum "bnd-sacco-${STAMP}.dump" | tee "bnd-sacco-${STAMP}.sha256"
ls -lh "bnd-sacco-${STAMP}.dump"
```

Record the size and the digest in the backup log. A dump that is suddenly a
tenth of last week's size is the only early warning you get.

### Handling the file

This file contains every member's name, phone number, national ID, savings,
shares and loan history. Treat it as the most sensitive thing the SACCO owns.

- **Encrypt it before it leaves the machine.**

  ```bash
  gpg --symmetric --cipher-algo AES256 "bnd-sacco-${STAMP}.dump"
  shred -u "bnd-sacco-${STAMP}.dump"    # the plaintext does not linger
  ```

- Store the encrypted copy somewhere that is **not** the same account as the
  Supabase project, so losing access to one does not lose both.
- Keep the passphrase somewhere the committee can reach without the person who
  took the backup. A backup only they can open is not a SACCO backup.
- Never commit a dump to the repository. Never leave one on a laptop. Never
  attach one to an email or paste it into a chat.
- Keep a sensible rotation: the last 4 weekly, the last 6 monthly. Delete the
  rest, and delete them properly.

### How often

Weekly is the minimum, and **immediately before any migration** — the release
runbook requires it as a gate, not a suggestion.

A SACCO posting daily collections loses up to a week of counter activity with
weekly backups. If that is unacceptable — and it probably is — that is the
argument for option A rather than for backing up more often by hand.

---

## 3. The restore rehearsal — the part that matters

The whole point. It can be done entirely against a disposable database, with no
risk to anything, using the harness already in this repository
(`documentation/source/test-stack/`).

```bash
# 1. A throwaway target. Local PostgreSQL 16; nothing hosted.
createdb -h 127.0.0.1 -p 54322 -U postgres bnd_restore_test

# 2. The Supabase-compatible bootstrap the migrations expect.
psql -v ON_ERROR_STOP=1 "postgresql://postgres@127.0.0.1:54322/bnd_restore_test" \
     -f documentation/source/test-stack/00_bootstrap.sql
psql -v ON_ERROR_STOP=1 "postgresql://postgres@127.0.0.1:54322/bnd_restore_test" \
     -f documentation/source/test-stack/01_storage.sql

# 3. The dump.
gpg --decrypt "bnd-sacco-${STAMP}.dump.gpg" > /tmp/restore.dump
pg_restore --no-owner --no-privileges --clean --if-exists \
           --dbname "postgresql://postgres@127.0.0.1:54322/bnd_restore_test" /tmp/restore.dump
shred -u /tmp/restore.dump
```

Then **prove it is the SACCO's books**, not merely that the command exited 0:

```sql
-- Does it hold what production holds?
select 'members' k, count(*) v from members
union all select 'transactions', count(*) from transactions
union all select 'loans',        count(*) from loans
union all select 'logins',       count(*) from app_users
union all select 'auth users',   count(*) from auth.users;

-- Do the figures reconcile? These are the audit's own invariants; every one
-- held exactly on production, so every one must hold here.
--   docs/audits/evidence/03-accounting-invariants.sql
```

```bash
# And does the application's own test battery pass against the restored copy?
PGSSLMODE=disable \
DATABASE_URL="postgresql://postgres@127.0.0.1:54322/bnd_restore_test" \
  npm run test:db
```

A rehearsal is successful when **all three** are true: the counts match
production, every accounting invariant holds, and the SQL suites pass. Anything
less and the backup is not known to work.

Record the date, who did it, the dump it used, and the three results. Then:

```bash
dropdb -h 127.0.0.1 -p 54322 -U postgres bnd_restore_test
```

Rehearse at least **quarterly**, and after any change to the schema or the
backup procedure. Put it in the same calendar as the AGM — it is the same kind
of obligation.

---

## 4. Restoring for real

Only when the live project cannot be repaired forward. A restore throws away
every transaction posted since the dump, and those are real payments real
members made.

1. **Switch on maintenance mode, with `MAINTENANCE_BYPASS_TOKEN` set.** Members
   see a proper page; the operator can still reach the application. Without the
   token the gate now refuses to close rather than locking everyone out (F-10),
   which is safe but not what you want here.
2. **Write down what is being lost.** Query what you still can. Get the counter
   records for the period between the dump and now, on paper, before you start.
3. **Restore into a new database or project first**, and run §3's three checks
   against it. Never restore over the live database as the first attempt.
4. **Repoint the application** at the restored database and verify §6 of the
   release runbook.
5. **Re-enter the lost transactions** from the counter records, through the
   application, as normal postings by the officers who originally took them —
   never by writing to the database. The idempotency keys will differ and the
   references will be new; that is correct, and the audit trail will show when
   and by whom they were re-entered.
6. **Switch maintenance mode off.** Tell the SACCO plainly what happened, what
   was lost, and what was re-entered.
7. **Write it up.** What failed, what the recovery cost, and what would have
   made it shorter.

---

## 5. What this does not cover

Said plainly, because a recovery plan that overstates itself is worse than none.

- **Supabase Storage.** Member profile photos and uploaded finance documents
  live in a storage bucket, not in the database, so `pg_dump` does not include
  them. The database keeps the references; a restore would leave them pointing
  at files that are gone. Backing the bucket up is a separate job, and it is not
  done. It is lower stakes than the ledger — a missing photo is not a missing
  payment — but it should be recorded as a known gap rather than discovered
  during a recovery.
- **Supabase Auth configuration.** Redirect allow-lists, email templates, rate
  limits and provider settings are project configuration, not database rows.
  Write them down somewhere outside the project.
- **Environment variables.** Vercel holds them. A restored database with no
  matching configuration runs nothing. Keep an inventory of the *names* (never
  the values) and who can supply each one.
- **This has not been rehearsed.** No restore test has been performed, because
  that would require a copy of production data and this work took none. The
  procedure above is written to be followed; until somebody follows it, the
  SACCO's recovery position is unproven.
