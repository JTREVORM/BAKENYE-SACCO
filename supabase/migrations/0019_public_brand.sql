-- ===========================================================================
-- BUD-SACCO - 0019 - The SACCO's name, before anyone has signed in
--
-- `sacco_settings` is readable by authenticated users only, which is right: it
-- carries the registered number and the postal address, and there is no reason
-- for those to be readable by the open internet.
--
-- But the sign-in screen has to say whose SACCO it is, and it renders for
-- someone who by definition has not signed in. Until now it said so with a
-- string literal in `AuthShell.tsx`, which meant the one screen every member
-- sees first was also the one screen where correcting the SACCO's name needed a
-- developer.
--
-- So: a function that returns exactly the fields that are already public - the
-- name, the short name, the motto and the contact details the SACCO publishes
-- for people to reach it by, all of which are printed on documents handed to
-- the public. The postal address and the registration number stay behind the
-- login.
--
-- The contact fields are nullable and are returned as null when unset. The
-- sign-in footer renders them only when they are actually there, rather than
-- printing a placeholder telephone number that nobody answers.
-- ===========================================================================

create or replace function sacco_public_brand()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'legal_name',    legal_name,
    'short_name',    short_name,
    'motto',         motto,
    'contact_email', contact_email,
    'contact_phone', contact_phone)
    from sacco_settings where id;
$fn$;

comment on function sacco_public_brand() is
  'Public branding only: name, short name, motto and published contact details. '
  'Deliberately excludes the postal address and registration number, which stay '
  'behind the login.';

grant execute on function sacco_public_brand() to anon, authenticated;
