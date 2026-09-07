-- ===========================================================================
-- BND-SACCO - 0010 - Three more roles
--
-- Adding enum values has to be committed before anything can compare against
-- them, so this migration does nothing else. 0011 wires them into the
-- capability predicates, the policies and the functions.
--
--   accountant    - the books: transactions, income, expenses, reports
--   group_officer - assigned groups: members, schedules, collections
--   viewer        - read-only, everywhere it is safe to read
-- ===========================================================================

alter type user_role add value if not exists 'accountant';
alter type user_role add value if not exists 'group_officer';
alter type user_role add value if not exists 'viewer';
