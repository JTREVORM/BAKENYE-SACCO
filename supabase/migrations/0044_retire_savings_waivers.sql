-- ===========================================================================
-- BUD-SACCO - 0044 - Retiring the savings waiver
--
-- A waiver existed to forgive a savings expectation: a manager wrote off, with
-- a reason, an amount the SACCO had asked a member for and decided not to
-- pursue. 0043 removed the expectation. Under open monthly savings there is no
-- required amount, so there is nothing to forgive, and a control that forgives
-- nothing is a control that can only confuse.
--
-- This migration removes the ability to create a new waiver. It removes no
-- waiver that already exists.
--
-- WHAT IS KEPT, AND WHY
--
--   * Every `savings_periods` row already marked `waived` keeps that status,
--     its paid amount and its place in the member's history. A manager made
--     that decision in writing and the record of it stands.
--   * `savings_status` keeps its `waived` value. Removing an enum value in
--     place is not possible in PostgreSQL without rewriting the rows that use
--     it, which is exactly what must not happen here.
--   * Every `savings.waived` entry in the audit log stays where it is, naming
--     who waived what and why.
--   * `recompute_savings_period()` keeps its rule that a waived period stays
--     waived whatever happens to the payments around it, so a historical
--     waiver survives a later reversal exactly as it always did.
--   * `record_scheduled_savings()` keeps refusing to record into a waived
--     month, so a month a manager closed stays closed.
--   * The `savings.waive` permission row and every role that holds it are left
--     exactly as they are. Narrowing a role's permission set is not this
--     migration's business; nothing in the application reaches a waiver
--     through it any more.
--
-- WHAT IS REMOVED
--
--   The one function that could create a waiver.
-- ===========================================================================

drop function if exists waive_savings_schedule(uuid, text);

comment on type savings_status is
  'The state of one member''s savings month. Since 0043 only `paid` (money went in) and `pending` (none did) are ever set on a new row; `partial`, `missed` and `waived` survive on rows raised under the old savings targets, and on months a manager waived before 0044 retired waivers. None of the three is raised again.';

comment on column savings_periods.status is
  'Set from the posted payment rows by recompute_savings_period(). A row already marked `waived` keeps that status for ever: the waiver was a written management decision and 0044, which removed the ability to make a new one, does not undo the ones already made.';

-- ---------------------------------------------------------------------------
-- A note in the audit log, so the change is discoverable from inside the
-- system rather than only from the migration history.
-- ---------------------------------------------------------------------------
do $$
declare
  v_waived integer;
begin
  select count(*) into v_waived from savings_periods where status = 'waived';

  insert into audit_logs (actor_name, action, module, record_id, summary,
                          old_value, new_value, reason)
  values ('system (migration 0044)', 'savings.waivers_retired', 'Savings', null,
          format('Savings waivers retired. %s waived month(s) kept untouched.', v_waived),
          jsonb_build_object('waived_periods_before', v_waived),
          jsonb_build_object('waived_periods_after', v_waived,
                             'new_waivers_possible', false),
          'Approved business rule change: monthly savings are open, so there is no required '
          || 'amount to waive. Waivers already recorded are kept in full for audit.');
end $$;
