import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export const PHONE_HINT = 'Use 07XXXXXXXX for Uganda, or + and the country code for an international number, e.g. +1 416 555 0123.';
export const PHONE_ERROR = 'Enter a valid Uganda number or an international number starting with + and its country code.';

/** Accept formatting separators, never letters, extensions or embedded plus signs. */
function compactPhone(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim();
  if (!raw || !/^\+?[0-9\s().-]+$/.test(raw)) return null;
  return raw.replace(/[\s().-]/g, '');
}

/** Retain the SACCO's existing Uganda mobile input formats. */
export function normaliseUgandanMobile(phone: string | null | undefined): string | null {
  let digits = compactPhone(phone);
  if (!digits) return null;
  // An explicit international code must never be interpreted as a local number.
  if (digits.startsWith('+')) return /^\+2567\d{8}$/.test(digits) ? digits : null;
  if (digits.startsWith('00256')) digits = digits.slice(2);
  if (digits.startsWith('256')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return /^7\d{8}$/.test(digits) ? `+256${digits}` : null;
}

/** E.164, validated against country numbering plans; null for invalid input. */
export function normalisePhone(phone: string | null | undefined): string | null {
  const compact = compactPhone(phone);
  if (!compact) return null;
  const uganda = normaliseUgandanMobile(compact);
  if (uganda) return uganda;
  if (!/^\+[1-9]\d{1,14}$/.test(compact)) return null;
  const parsed = parsePhoneNumberFromString(compact, { extract: false });
  // Do not silently remove a trunk prefix from an explicitly international number.
  return parsed?.number === compact && parsed.isValid() ? compact : null;
}

/** Keep Uganda's familiar display; retain the + and calling code everywhere else. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const uganda = normaliseUgandanMobile(phone);
  if (!uganda) return phone;
  const local = `0${uganda.slice(4)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
