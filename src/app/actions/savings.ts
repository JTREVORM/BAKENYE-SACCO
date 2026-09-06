'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import type { SavingsKind } from '@/types/db';

/**
 * Bulk-open the savings periods for a cycle.
 *
 * Idempotent by construction: `ensure_savings_period()` upserts, so running it
 * twice for the same week does not duplicate anything.
 */
export async function openSavingsPeriods(
  kind: SavingsKind,
  on: string,
): Promise<ActionResult<number>> {
  const user = await requireUser();
  if (!can(user.role, 'savings.record')) {
    return { ok: false, error: 'You do not have permission to open savings periods.' };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) {
    return { ok: false, error: 'Choose a valid date.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('open_savings_periods', {
    p_kind: kind,
    p_on: on,
  });

  if (error) return fail(error);

  revalidatePath('/staff/savings');

  const count = (data as number) ?? 0;
  return succeed(
    count,
    `Opened the ${kind} period for ${count} active ${count === 1 ? 'member' : 'members'}.`,
  );
}
