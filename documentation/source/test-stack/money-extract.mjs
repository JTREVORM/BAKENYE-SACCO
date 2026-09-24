const groupFormatter = new Intl.NumberFormat('en-UG', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});


export function groupDigits(raw) {
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (!cleaned) return '';

  // Only the first dot is a decimal point; anything after it is a typo.
  const dot = cleaned.indexOf('.');
  const whole = (dot === -1 ? cleaned : cleaned.slice(0, dot)).replace(/\D/g, '');
  const fraction = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\D/g, '').slice(0, 2);

  if (!whole && fraction === null) return '';
  const grouped = whole ? groupFormatter.format(Number(whole)) : '0';

  // A trailing dot is kept so somebody typing "1200." can go on to the cents.
  return fraction === null ? grouped : `${grouped}.${fraction}`;
}
export function ungroupDigits(display) {
  const cleaned = display.replace(/,/g, '');
  if (!cleaned || cleaned === '.') return '';
  return cleaned.endsWith('.') ? cleaned.slice(0, -1) : cleaned;
}