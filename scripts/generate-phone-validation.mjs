/** Emit a validation function for a NEW migration when phone metadata changes.
 * Never regenerate or edit an already applied migration.
 * Uses the same pinned numbering plans as src/lib/phone.ts, including number
 * types and their possible lengths, without adding a mutable lookup table.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const metadata = require('libphonenumber-js/metadata.max.json');
const version = require('libphonenumber-js/package.json').version;
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const lengths = (ns) => `(?:${ns.map((n) => `[0-9]{${n}}`).join('|')})`;
const plans = [...Object.entries(metadata.countries), ...Object.entries(metadata.nonGeographic)];
const rows = plans.map(([region, data], index) => {
  const types = (data[11] || []).filter((t) => t?.[0]);
  const pattern = types.length
    ? types.map((t) => `(?=${lengths(t[1] || data[3])}$)(?:${t[0]})`).join('|')
    : `(?=${lengths(data[3])}$)(?:${data[2]})`;
  return `    (${quote(data[0])}, ${quote(`^(?:${data[2]})$`)}, ${quote(`^(?:${pattern})$`)})${index < plans.length - 1 ? ',' : ''} -- ${region}`;
}).join('\n');
console.log(`-- Numbering plans generated from libphonenumber-js ${version} metadata.max.json.
-- Uganda mobile ranges intentionally retain the SACCO's existing acceptance.
create or replace function valid_e164_phone(p text)
returns boolean language sql immutable parallel safe as $phone_plans$
  select coalesce(p ~ '^\\+[1-9][0-9]{1,14}$' and (
    p ~ '^\\+2567[0-9]{8}$' or exists (
      select 1 from (values
${rows}
      ) as plans(calling_code, general_pattern, type_pattern)
      where substr(p, 2, length(calling_code)) = calling_code
        and substr(p, 2 + length(calling_code)) ~ general_pattern
        and substr(p, 2 + length(calling_code)) ~ type_pattern
    )
  ), false);
$phone_plans$;`);
