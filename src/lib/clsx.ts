/**
 * Minimal class-name joiner.
 *
 * Deliberately not the `clsx` npm package: this is ~15 lines, has no install
 * cost, and every kilobyte of client JS matters for the low-end Android phones
 * the SACCO membership actually uses.
 */
type ClassValue = string | number | null | undefined | false | ClassValue[] | Record<string, unknown>;

export function clsx(...inputs: ClassValue[]): string {
  const out: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
    } else if (Array.isArray(input)) {
      const nested = clsx(...input);
      if (nested) out.push(nested);
    } else {
      for (const [key, value] of Object.entries(input)) {
        if (value) out.push(key);
      }
    }
  }

  return out.join(' ');
}
