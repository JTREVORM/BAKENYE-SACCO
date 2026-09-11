import { getSettingsMap, settingBool, settingNumber } from '@/lib/settings';
import { can, type Access } from '@/lib/rbac';
import { formatUGX } from '@/lib/money';

/**
 * What happens after "confirm" on a transfer or payment, for this person,
 * under the Cash & Bank settings as they stand. The database applies the same
 * rules in `treasury_requires_approval()`; this only says them out loud before
 * the form is submitted, so nobody is surprised by "submitted for approval".
 */
export async function approvalNoteFor(role: Access): Promise<string> {
  const map = await getSettingsMap();
  const required = settingBool(map, 'treasury.require_approval', true);
  const threshold = settingNumber(map, 'treasury.approval_threshold');
  const fourEyes = settingBool(map, 'treasury.four_eyes');
  const approver = can(role, 'finance.approve');

  if (!required) return 'It completes as soon as you confirm - approval is switched off in Settings.';
  if (approver && !fourEyes) return 'You can approve, so it completes as soon as you confirm.';

  const who = approver ? 'a second approver' : "a manager's approval";
  if (threshold > 0) {
    return `Amounts above ${formatUGX(threshold)} wait for ${who}; smaller amounts complete as soon as you confirm.`;
  }
  return approver
    ? 'It waits for a second approver - under four eyes nobody approves their own entry.'
    : "It waits for a manager's approval before any money moves.";
}

/** Monday of the week containing `d`, as YYYY-MM-DD. */
export function weekStart(d: Date = new Date()): string {
  const day = (d.getDay() + 6) % 7;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
}
