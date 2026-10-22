-- ===========================================================================
-- BUD-SACCO - 0050 - Reading back an uncertain financial submission
--
-- The reliability gap behind the "it posted but the screen said nothing"
-- reports, and the smallest thing the backend can add to close it.
--
-- WHAT WAS ALREADY RIGHT, AND IS NOT CHANGED HERE
--
-- Posting is already safe against every duplicate this can cause.
-- `post_transaction()` returns the original row when it sees an idempotency
-- key it has posted before, a unique partial index on
-- `transactions(idempotency_key)` makes that race-proof, and `FinancialForm`
-- holds one stable key per form instance and regenerates it only after a
-- success. So a double tap, a browser resend and a dropped response all carry
-- a key the server has already seen, and all post exactly once. The audit's
-- concurrency suite confirmed this, and nothing in this migration alters the
-- posting path, the ledger, the numbering or any financial calculation.
--
-- WHAT WAS MISSING
--
-- The *uncertain* case. The cashier taps Confirm, the request reaches the
-- database and commits, and the response is lost on the way back - a dropped
-- 3G connection, a serverless timeout, a closed laptop. The browser still
-- holds the idempotency key, but it had no way to ask "did that one land?".
-- Re-submitting is safe, but it is not an answer, and it is not something a
-- cashier should have to do to find out whether the SACCO has the money.
--
-- This migration adds exactly one read-only question and no new authority:
--
--   submission_status(key) -> what happened to the posting made under this key
--
-- It creates nothing, posts nothing, reverses nothing and repairs nothing.
-- Automatic reposting and automatic reversal of an uncertain transaction are
-- deliberately not implemented: deciding that a payment did not happen is a
-- counter procedure, not something software should infer from a timeout.
--
-- AUTHORISATION
--
-- A caller may read back only a submission they themselves recorded
-- (`transactions.recorded_by = auth.uid()`). That is narrower than the
-- `transactions` RLS policy on purpose - this is a receipt for your own
-- submission, not a search tool - and it is why the function needs no new
-- permission key. Idempotency keys are client-generated randoms, so there is
-- nothing to enumerate; scoping to the recorder means there would be nothing
-- to learn even if there were.
-- ===========================================================================

begin;

/**
 * What became of the posting submitted under this idempotency key?
 *
 * Returns, always as an object, never an error for a key that is simply absent:
 *
 *   { "found": false }
 *       Nothing was posted under this key. Either the request never arrived,
 *       or it failed before committing. Nothing is owed and nothing is
 *       half-done: the submission can be made again, with the same key.
 *
 *   { "found": true, "status": "posted", "reference": "SAV261022091", ... }
 *       It landed. `reference` is the document number to show and to print a
 *       receipt from. Re-submitting the same key would return this same row.
 *
 *   { "found": true, "status": "reversed", "reversed": true, ... }
 *       It landed and has since been reversed, by `reversal_reference`. The
 *       money is back. Do not re-submit; this is a reversal to explain, not a
 *       posting to retry.
 *
 * `amount` is text, not a number, so a JSON client cannot round a shilling
 * amount through a float on its way to a screen.
 */
create or replace function public.submission_status(p_idempotency_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_txn        transactions;
  v_receipt    text;
  v_reversal   text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to check a submission.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    return jsonb_build_object('found', false);
  end if;

  -- Only your own submission. Not a lookup over other people's postings.
  select * into v_txn
    from transactions
   where idempotency_key = p_idempotency_key
     and recorded_by = auth.uid();
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select receipt_no into v_receipt from receipts where transaction_id = v_txn.id;
  select reference  into v_reversal from transactions where id = v_txn.reversed_by_id;

  return jsonb_build_object(
    'found',              true,
    'status',             v_txn.status,
    'transaction_id',     v_txn.id,
    'reference',          v_txn.reference,
    'type',               v_txn.type,
    'method',             v_txn.method,
    'amount',             v_txn.amount::text,
    'occurred_on',        v_txn.occurred_on,
    'recorded_at',        v_txn.created_at,
    'description',        v_txn.description,
    'receipt_no',         v_receipt,
    'reversed',           v_txn.reversed_by_id is not null,
    'reversal_reference', v_reversal);
end;
$$;

revoke all on function public.submission_status(text) from public, anon, authenticated, service_role;
grant execute on function public.submission_status(text) to authenticated;

commit;
