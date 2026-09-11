-- ===========================================================================
-- BUD-SACCO - 0028 - Member lifecycle states
--
-- A member is now registered as `pending` until the fees the SACCO has made
-- mandatory are paid, and a member who has left is `archived` rather than
-- deleted. `exited` stays in the type because enum values cannot be dropped
-- and older audit entries name it; the application offers `archived` instead.
--
-- New enum values must be committed before anything compares against them,
-- which is why this migration does nothing else. 0029 and 0030 use them.
-- ===========================================================================

alter type member_status add value if not exists 'pending' before 'active';
alter type member_status add value if not exists 'archived';
