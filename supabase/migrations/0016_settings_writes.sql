-- ===========================================================================
-- BUD-SACCO - 0016 - Changing a setting
--
-- 0015 built the registry and described every setting in it. This is the way
-- in: one entry point that validates a batch of changes against the registry's
-- own declared types and bounds, applies them in a single transaction, and
-- writes an audit row per key carrying the value before and the value after.
--
-- Either the whole batch lands or none of it does. A settings screen that
-- saved four fields of six and then reported an error would leave the SACCO in
-- a configuration nobody chose, which for a table that decides fees is not an
-- acceptable failure mode.
-- ===========================================================================

/**
 * A setting's value as a person would read it.
 *
 * The audit log is read by people asking "what was the registration fee before
 * September", and `{"value": 20000}` is a worse answer than `UGX 20,000`.
 */
create or replace function format_setting_value(
  p_type setting_value_type, p_value jsonb, p_unit text default null
) returns text language plpgsql immutable as $fn$
declare v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return 'nothing';
  end if;

  case p_type
    when 'boolean' then
      return case when (p_value #>> '{}')::boolean then 'on' else 'off' end;
    when 'money' then
      return 'UGX ' || trim(to_char((p_value #>> '{}')::numeric, 'FM999,999,999,990.##'));
    when 'percent' then
      return trim(to_char((p_value #>> '{}')::numeric, 'FM999,990.###')) || '%';
    when 'multiselect' then
      select string_agg(e #>> '{}', ', ') into v from jsonb_array_elements(p_value) e;
      return coalesce(v, 'none');
    when 'integer' then
      return trim(to_char((p_value #>> '{}')::numeric, 'FM999,999,999'))
             || coalesce(' ' || p_unit, '');
    when 'number' then
      return trim(to_char((p_value #>> '{}')::numeric, 'FM999,999,990.##'))
             || coalesce(' ' || p_unit, '');
    else
      return p_value #>> '{}';
  end case;
end;
$fn$;

/**
 * Check one proposed value against its own registry row.
 *
 * Kept separate from the write so the settings screen can be told what is
 * wrong using exactly the rules the write will apply, rather than a second
 * copy of them in TypeScript that drifts.
 */
create or replace function assert_setting_value_valid(p_key text, p_value jsonb)
returns void language plpgsql stable security definer set search_path = public as $fn$
declare
  s    system_settings;
  v    numeric;
  item jsonb;
begin
  select * into s from system_settings where key = p_key;
  if not found then
    raise exception 'There is no setting called %.', p_key using errcode = 'no_data_found';
  end if;

  if p_value is null or jsonb_typeof(p_value) = 'null' then
    raise exception '% cannot be left empty.', s.label using errcode = 'check_violation';
  end if;

  case s.value_type
    when 'boolean' then
      if jsonb_typeof(p_value) <> 'boolean' then
        raise exception '% must be on or off.', s.label using errcode = 'check_violation';
      end if;

    when 'text' then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception '% must be text.', s.label using errcode = 'check_violation';
      end if;

    when 'select' then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception '% must be one of the offered choices.', s.label
          using errcode = 'check_violation';
      end if;
      if s.options is not null and not exists (
        select 1 from jsonb_array_elements(s.options) o where o ->> 'value' = p_value #>> '{}'
      ) then
        raise exception '% is not one of the choices for %.', p_value #>> '{}', s.label
          using errcode = 'check_violation';
      end if;

    when 'multiselect' then
      if jsonb_typeof(p_value) <> 'array' then
        raise exception '% must be a list of choices.', s.label using errcode = 'check_violation';
      end if;
      if s.options is not null then
        for item in select * from jsonb_array_elements(p_value) loop
          if not exists (
            select 1 from jsonb_array_elements(s.options) o where o ->> 'value' = item #>> '{}'
          ) then
            raise exception '% is not one of the choices for %.', item #>> '{}', s.label
              using errcode = 'check_violation';
          end if;
        end loop;
      end if;

    else
      -- money, number, integer, percent
      if jsonb_typeof(p_value) <> 'number' then
        raise exception '% must be a number.', s.label using errcode = 'check_violation';
      end if;
      v := (p_value #>> '{}')::numeric;

      if s.value_type = 'integer' and v <> trunc(v) then
        raise exception '% must be a whole number.', s.label using errcode = 'check_violation';
      end if;
      if s.value_type = 'money' and round(v, 2) <> v then
        raise exception '% may not have more than two decimal places.', s.label
          using errcode = 'check_violation';
      end if;
      if s.min_value is not null and v < s.min_value then
        raise exception '% cannot be less than %.', s.label,
          format_setting_value(s.value_type, to_jsonb(s.min_value), s.unit)
          using errcode = 'check_violation';
      end if;
      if s.max_value is not null and v > s.max_value then
        raise exception '% cannot be more than %.', s.label,
          format_setting_value(s.value_type, to_jsonb(s.max_value), s.unit)
          using errcode = 'check_violation';
      end if;
  end case;
end;
$fn$;

/**
 * Rules that span more than one setting.
 *
 * A value can be perfectly legal on its own and nonsense beside its neighbour:
 * a smallest withdrawal above the largest one, a group minimum above the group
 * maximum. Those cannot be expressed as bounds on a single row, so they are
 * checked here - after the batch has been applied, before the transaction is
 * allowed to commit.
 */
create or replace function assert_settings_coherent()
returns void language plpgsql stable security definer set search_path = public as $fn$
declare
  v_min_w numeric := setting_number('financial.min_withdrawal');
  v_max_w numeric := setting_number('financial.max_withdrawal_per_transaction');
  v_min_g integer := setting_int('groups.min_members');
  v_max_g integer := setting_int('groups.max_members');
begin
  if v_max_w > 0 and v_min_w > v_max_w then
    raise exception 'The smallest withdrawal (UGX %) cannot be more than the largest withdrawal (UGX %).',
      trim(to_char(v_min_w, 'FM999,999,999')), trim(to_char(v_max_w, 'FM999,999,999'))
      using errcode = 'check_violation';
  end if;

  if v_max_g > 0 and v_min_g > v_max_g then
    raise exception 'The smallest group (%) cannot be larger than the largest group (%).',
      v_min_g, v_max_g using errcode = 'check_violation';
  end if;
end;
$fn$;

/**
 * Apply a batch of settings changes.
 *
 * `p_changes` is an object of key to new value:
 * `{"members.registration_fee": 20000, "loans.require_guarantors": false}`.
 *
 * Keys that are absent are left alone. Keys whose value already matches are
 * skipped entirely, so pressing Save without having changed anything writes no
 * audit noise. Returns the keys that actually changed.
 */
create or replace function update_settings(p_changes jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  k         text;
  v_new     jsonb;
  s         system_settings;
  v_changed text[] := '{}';
begin
  perform assert_capability(can_manage_settings(), 'change SACCO settings');

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'No settings were supplied.' using errcode = 'check_violation';
  end if;

  -- Validate the whole batch before writing any of it, so that a bad sixth
  -- field does not leave the first five applied.
  for k, v_new in select * from jsonb_each(p_changes) loop
    perform assert_setting_value_valid(k, v_new);
  end loop;

  for k, v_new in select * from jsonb_each(p_changes) loop
    select * into s from system_settings where key = k;

    continue when s.value = v_new;

    update system_settings
       set value      = v_new,
           updated_at = now(),
           updated_by = auth.uid()
     where key = k;

    v_changed := v_changed || k;

    perform write_audit(
      'settings.' || k, 'Settings', k,
      format('%s changed from %s to %s',
             s.label,
             format_setting_value(s.value_type, s.value, s.unit),
             format_setting_value(s.value_type, v_new, s.unit)),
      jsonb_build_object('key', k, 'label', s.label, 'value', s.value),
      jsonb_build_object('key', k, 'label', s.label, 'value', v_new),
      nullif(btrim(coalesce(p_reason, '')), ''));
  end loop;

  perform assert_settings_coherent();

  return jsonb_build_object('changed', to_jsonb(v_changed));
end;
$fn$;

/**
 * Put one setting back to what it shipped as.
 *
 * Goes through the same audited path, so restoring a default is as legible in
 * the log as changing it was.
 */
create or replace function reset_setting(p_key text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare s system_settings;
begin
  perform assert_capability(can_manage_settings(), 'change SACCO settings');

  select * into s from system_settings where key = p_key;
  if not found then
    raise exception 'There is no setting called %.', p_key using errcode = 'no_data_found';
  end if;

  return update_settings(
    jsonb_build_object(p_key, s.default_value),
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Restored the original value'));
end;
$fn$;

grant execute on function update_settings(jsonb, text)                          to authenticated;
grant execute on function reset_setting(text, text)                             to authenticated;
grant execute on function assert_setting_value_valid(text, jsonb)               to authenticated;
grant execute on function assert_settings_coherent()                            to authenticated;
grant execute on function format_setting_value(setting_value_type, jsonb, text) to authenticated;

-- `define_setting` is a deployment tool, not an application one: it is how a
-- migration introduces a setting, and nothing a signed-in user should reach.
revoke all on function define_setting(text, setting_category, text, setting_value_type,
                                      jsonb, text, text, numeric, numeric, jsonb,
                                      boolean, integer) from public;
revoke all on function define_setting(text, setting_category, text, setting_value_type,
                                      jsonb, text, text, numeric, numeric, jsonb,
                                      boolean, integer) from authenticated;
