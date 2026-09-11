-- ===========================================================================
-- BUD-SACCO - 0033 - Passwords chosen before 0032 existed
--
-- `app_users.password_set_at` (0032) records when an account holder chose
-- their own password. Staff accounts that existed before it, and have been
-- signing in with their own password, would otherwise show as "awaiting
-- password setup" - which is untrue. Their last sign-in is the best evidence
-- there is of a password in use, so it is recorded as the date.
--
-- Member logins are deliberately left alone. Before 0032 a member's password
-- was derived by the server from their phone number and never chosen by them,
-- so "awaiting password setup" is exactly right: they need a setup code.
-- ===========================================================================

update app_users u
   set password_set_at = u.last_login_at
  from roles r
 where r.key = u.role
   and r.kind = 'staff'
   and u.password_set_at is null
   and u.last_login_at is not null;
