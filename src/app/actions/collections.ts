'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import type { PaymentMethod, SavingsStatus } from '@/types/db';

/**
 * Manual savings collection.
 *
 * PHASE ONE IS MANUAL, DELIBERATELY. Choosing "Mobile Money" here records that
 * a transfer was received outside the system; it does not call MTN, Airtel or
 * any gateway, and nothing in this file marks a payment confirmed that a person
 * has not confirmed. The `payment_intents` row the database writes carries
 * provider = 'manual' for exactly that reason — when a provider is added in
 * Phase Two it settles the same row through the same function, and this action
 * does not change.
 */

export type CollectionResult = {
  transaction_id: string;
  reference: string;
  schedule_id: string;
  period_id: string;
  member_id: string;
  member_name: string;
  period_label: string;
  /** What the member has saved in this month, after this deposit. */
  paid: number;
  period_total: number;
  status: SavingsStatus;
};

const METHODS = ['cash', 'mobile_money', 'bank_transfer', 'cheque'] as const;

const collectionSchema = z.object({
  schedule_id: z.string().uuid('That savings schedule could not be found.'),
  amount: z.coerce
    .number()
    .positive('Enter the amount received.')
    .max(500_000_000, 'That amount looks incorrect. Check the figure and try again.'),
  paid_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date the payment was received.'),
  method: z.enum(METHODS),
  external_ref: z
    .string()
    .trim()
    .max(80, 'Keep the reference under 80 characters.')
    .optional()
    .transform((v) => (v ? v : undefined)),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
  idempotency_key: z.string().min(8).max(120),
  /** Whose screen to refresh afterwards; used only for cache revalidation. */
  member_id: z.string().uuid().optional().or(z.literal('')),
});

/**
 * Record one member's contribution against their schedule for the cycle.
 *
 * The schedule is the unit of work, not the member: a cashier at the counter is
 * settling a specific expectation, and posting against the schedule is what
 * keeps "expected 50,000 / paid 30,000 / outstanding 20,000" true without any
 * arithmetic in the browser.
 */
export async function recordCollection(
  _prev: ActionResult<CollectionResult> | null,
  formData: FormData,
): Promise<ActionResult<CollectionResult>> {
  const user = await requireUser();
  if (!can(user, 'savings.record')) {
    return { ok: false, error: 'You do not have permission to record savings.' };
  }

  const parsed = collectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const d = parsed.data;

  // Mobile money and bank transfers happened somewhere else. Without the
  // reference from that transfer there is nothing to reconcile against later,
  // so it is required for those methods and optional for cash counted in hand.
  if ((d.method === 'mobile_money' || d.method === 'bank_transfer') && !d.external_ref) {
    return {
      ok: false,
      error:
        d.method === 'mobile_money'
          ? 'Enter the mobile money transaction reference from the confirmation message.'
          : 'Enter the bank transfer or deposit slip reference.',
      field: 'external_ref',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('record_scheduled_savings', {
    p_schedule_id: d.schedule_id,
    p_amount: d.amount,
    p_paid_on: d.paid_on,
    p_method: d.method as PaymentMethod,
    p_external_ref: d.external_ref ?? null,
    p_note: d.note ?? null,
    p_idempotency_key: d.idempotency_key,
  });

  if (error) return fail(error, 'amount');

  const result = data as unknown as CollectionResult;

  revalidatePath('/staff/savings/collect');
  revalidatePath('/staff/savings/records');
  revalidatePath('/staff/savings');
  revalidatePath('/staff');
  if (d.member_id) revalidatePath(`/staff/members/${d.member_id}`);

  // There is no target, so there is nothing to report as still owing. What the
  // cashier wants confirmed is the amount and the running total for the month.
  const month = Number(result.period_total);
  return succeed(
    result,
    `Savings recorded for ${result.member_name}. UGX ${month.toLocaleString('en-UG')} saved in ${result.period_label}.`,
  );
}
