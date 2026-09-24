-- ===========================================================================
-- 0042 — A guarantor may see who they are guaranteeing (finding V-5)
--
-- The member portal's Guarantees screen showed "Unknown member" against every
-- loan a member had agreed to back.
--
-- Row-level security is not the fault here, and is not changed by this file.
-- A member may read exactly one row of `members` - their own - which is
-- correct and deliberate. The screen nevertheless asked PostgREST to embed the
-- borrower through that table, got nothing back, and printed a placeholder.
--
-- Standing as a guarantor is a real financial obligation. A member who has
-- agreed to it needs to know whose debt it is, which loan, how much of it is
-- theirs, and where the loan has got to. Being shown a loan number and the
-- word "Unknown" is not enough to tell one guarantee from another.
--
-- The fix is a dedicated read path rather than a wider policy:
--
--   * SECURITY DEFINER, so it can read past RLS - but it decides for itself
--     what to disclose, and discloses only what a guarantor needs.
--   * Authorization IS the WHERE clause: g.member_id = current_member_id().
--     There is no parameter to tamper with, so a caller cannot ask about
--     anybody else's guarantees, and a member who guarantees nothing gets an
--     empty set.
--   * Staff who may already see loans get the same rows for a member they
--     name, so the office can answer a guarantor's question without being
--     handed a second, looser route into the member register.
--   * No phone number, no National ID, no savings, no shares, no other loans,
--     nothing about members the caller does not guarantee.
--   * STABLE and read-only: it grants no write path, so a guarantor still
--     cannot touch the loan they can now see.
--
-- This is the same shape as search_guarantor_candidates() (0029), which is how
-- a member already finds a guarantor by name: a function that answers one
-- narrow question instead of a policy that opens a table.
-- ===========================================================================

create or replace function my_guarantees(p_member_id uuid default null)
returns table (
  guarantee_id      uuid,
  guaranteed_amount numeric,
  guarantee_status  guarantor_status,
  responded_on      date,
  requested_on      timestamptz,
  loan_id           uuid,
  loan_no           text,
  loan_status       loan_status,
  principal         numeric,
  total_payable     numeric,
  outstanding       numeric,
  percent_repaid    numeric,
  applied_on        date,
  disbursed_on      date,
  next_due_on       date,
  purpose           text,
  borrower_name     text,
  borrower_no       text,
  borrower_photo    text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_me    uuid := current_member_id();
  v_staff boolean := has_permission('loans.view');
  v_for   uuid;
begin
  -- Whose guarantees are being asked about. A member may only ever ask about
  -- their own, whatever they pass; staff who may see loans may name a member.
  if v_staff and p_member_id is not null then
    v_for := p_member_id;
  else
    v_for := v_me;
  end if;

  if v_for is null then
    return;
  end if;

  return query
  select g.id,
         g.guaranteed_amount,
         g.status,
         g.responded_on,
         g.created_at,
         l.id,
         l.loan_no,
         l.status,
         l.principal,
         lb.total_payable,
         lb.outstanding,
         lb.percent_repaid,
         l.applied_on,
         l.disbursed_on,
         lb.next_due_on,
         l.purpose,
         -- The borrower, disclosed only because this caller has agreed to
         -- stand for this particular loan.
         m.full_name,
         m.member_no,
         m.photo_url
    from loan_guarantors g
    join loans   l  on l.id = g.loan_id
    join members m  on m.id = l.member_id
    left join loan_balances lb on lb.loan_id = l.id
   where g.member_id = v_for
   order by g.created_at desc;
end;
$fn$;

comment on function my_guarantees(uuid) is
  'The loans the caller has agreed to guarantee, with the borrower''s name and member number. Authorization is the WHERE clause: a member sees only their own guarantees. Discloses nothing else about the borrower (0042, finding V-5).';

-- Nothing internal is callable from outside by default (0030 §14): revoke
-- first, then grant back only to signed-in users.
revoke all on function my_guarantees(uuid) from public, anon;
grant execute on function my_guarantees(uuid) to authenticated;
