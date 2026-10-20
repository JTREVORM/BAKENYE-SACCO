# BKC-01 remediation review

The additive migration `20261020144523_verified_password_changes.sql` retires
`log_password_changed()`: all API execution grants are revoked and its body
rejects calls even if a future grant is accidentally restored. Historical
migrations are unchanged.

The server actions for initial password choice, profile password change and
email recovery now share this sequence:

1. Validate the form and native Auth user. Profile/initial choice additionally
   reauthenticate using the current password; recovery still requires its
   existing short-lived httpOnly recovery marker. Submitted account IDs are
   never accepted.
2. Call service-only `begin_password_change(user_id)`. The database locks the
   account and captures its current native Auth hash with a random nonce and
   ten-minute expiry in the unexposed `password_security` schema.
3. Await a successful native `auth.updateUser({password})` using the person's
   session, preserving Supabase's password validation and session behavior.
4. Call service-only `complete_password_change(user_id, nonce)`. The database
   requires the live Auth hash to differ, consumes the proof once, updates the
   password timestamps/lock and writes the existing account audit atomically.

Both RPCs check the service role independently of execution grants, use an empty
search path and qualify application/Auth objects. Clients have neither RPC
execution nor schema/table access. The proof table has RLS enabled with no client
policies. No plaintext password, Auth hash or nonce is written to the audit trail
or returned by completion. Each account has at most one proof; failed attempts
remain locked and a later attempt replaces the bounded, expiring proof.

The existing temporary-reset operation still locks first, then sets a generated
password using Auth's admin API. A trigger invalidates pending proofs on every
write of `must_change_password = true`, including true-to-true resets. Account-row
locks serialize begin/completion/reset. A newer reset therefore cannot be undone
by an earlier password-change request. Onboarding still creates a locked account.
No trigger on managed Auth tables or financial/security-policy rewrite is needed.

Permissions remain database-controlled and unchanged. Completing a password
change does not activate a disabled account, change its role, grant a permission
or bypass member restrictions. Native Auth retains responsibility for JWT/session
issuance, expiry, refresh rotation and revocation; this change does not claim
instant revocation of already issued access JWTs. Normal access-token lifetime in
the isolated browser run is 3600 seconds; native expiry and refresh are separately
tested.

If native Auth succeeds but completion fails, the server reports that the password
changed and account access could not be restored. The account holder must sign in
with that new password and retry; the database does not silently lift the lock.

## Rollout boundary

This branch contains a migration and matching server actions that must be
coordinated in an authorized release. The new application fails closed if the
migration is absent. The legacy application cannot complete a forced password
change after the old RPC is retired. Do not apply only one side and assume the
password workflow is certified. No production migration or deployment was
performed during this work.

The read-only production assessment found the vulnerable legacy body and an
`authenticated` execution grant. This finding does **not** establish exploitation
or inspect any account. Production remains unremediated until a separately
authorized migration/application rollout and hosted verification.

See [certification results](release-certification.md) and
[regression evidence](certification-evidence/password-results.json).
