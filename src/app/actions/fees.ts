'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import type { FeePaymentResult, FeeRow, MemberFeeRow } from '@/types/access';

/**
 * Fees: the Settings -> Fees register, and charging, paying and waiving what
 * a member owes. Amounts are always read from the `fees` table by the database;
 * nothing here supplies a figure of its own.
 */

function firstIssue(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0]) };
}

const bool = z
  .enum(['on', 'off', 'true', 'false'])
  .optional()
  .transform((v) => v === 'on' || v === 'true');

const feeSchema = z.object({
  fee_id: z.string().uuid().optional(),
  name: z.string().trim().min(2, 'Give the fee a name.').max(80),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  amount: z.coerce.number({ invalid_type_error: 'Enter an amount.' }).positive('Enter an amount greater than zero.'),
  fee_type: z.enum(['membership', 'registration', 'application', 'passbook', 'welfare', 'subscription', 'other']),
  charged_when: z.enum(['registration', 'annual', 'on_request']),
  is_mandatory: bool,
  applies_to_new_members: bool,
  applies_to_existing_members: bool,
  effective_from: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
  income_category_id: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null)),
});

function revalidateFees() {
  revalidatePath('/staff/settings');
  revalidatePath('/staff/members/new');
}

export async function saveFee(
  _prev: ActionResult<FeeRow> | null,
  formData: FormData,
): Promise<ActionResult<FeeRow>> {
  const user = await requireUser();
  if (!can(user, 'fees.manage')) {
    return { ok: false, error: 'You do not have permission to manage fees.' };
  }

  const parsed = feeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const { fee_id, reason, ...p } = parsed.data;

  const supabase = await createClient();
  const { data, error } = fee_id
    ? await supabase.rpc('update_fee', { p_fee_id: fee_id, p, p_reason: reason })
    : await supabase.rpc('create_fee', { p, p_reason: reason });
  if (error) return fail(error);

  revalidateFees();
  const fee = data as FeeRow;
  return succeed(fee, fee_id ? `${fee.name} updated.` : `${fee.name} created.`);
}

export async function setFeeStatus(
  _prev: ActionResult<FeeRow> | null,
  formData: FormData,
): Promise<ActionResult<FeeRow>> {
  const user = await requireUser();
  if (!can(user, 'fees.manage')) {
    return { ok: false, error: 'You do not have permission to manage fees.' };
  }

  const parsed = z
    .object({
      fee_id: z.string().uuid(),
      status: z.enum(['active', 'inactive']),
      reason: z.string().trim().min(5, 'Give a reason - it is kept in the audit log.').max(500),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_fee_status', {
    p_fee_id: parsed.data.fee_id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, 'reason');

  revalidateFees();
  const fee = data as FeeRow;
  return succeed(fee, `${fee.name} is now ${fee.status === 'active' ? 'active' : 'inactive'}.`);
}

/* ---------------------------------------------------------------- members */

function revalidateMember(memberId: string) {
  revalidatePath(`/staff/members/${memberId}`);
  revalidatePath('/staff/members');
  revalidatePath('/staff/finance');
}

export async function payMemberFees(
  _prev: ActionResult<FeePaymentResult> | null,
  formData: FormData,
): Promise<ActionResult<FeePaymentResult>> {
  const user = await requireUser();
  if (!can(user, 'fees.collect')) {
    return { ok: false, error: 'You do not have permission to record fee payments.' };
  }

  const parsed = z
    .object({
      member_id: z.string().uuid(),
      charge_ids: z
        .string()
        .transform((v) => v.split(',').filter(Boolean))
        .refine((ids) => ids.length > 0, 'Choose at least one fee to pay.')
        .refine((ids) => ids.every((id) => z.string().uuid().safeParse(id).success), 'Choose fees from the list.'),
      account_id: z.string().uuid({ message: 'Choose where the money was received.' }),
      method: z
        .enum(['cash', 'mobile_money', 'bank_transfer', 'cheque', ''])
        .optional()
        .transform((v) => (v ? v : null)),
      reference: z
        .string()
        .trim()
        .max(80)
        .optional()
        .transform((v) => (v ? v : null)),
      paid_on: z
        .string()
        .optional()
        .transform((v) => (v ? v : null)),
      amount_received: z.coerce.number().positive('Enter the amount received.'),
      idempotency_key: z.string().min(8).max(100),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pay_member_fees', {
    p_member_id: d.member_id,
    p_charge_ids: d.charge_ids,
    p_account_id: d.account_id,
    p_method: d.method,
    p_paid_on: d.paid_on,
    p_reference: d.reference,
    p_amount_received: d.amount_received,
    p_idempotency_key: d.idempotency_key,
  });
  if (error) return fail(error);

  revalidateMember(d.member_id);
  const result = data as FeePaymentResult;
  return succeed(
    result,
    result.duplicate ? 'This payment was already recorded. Nothing was recorded twice.' : 'Payment recorded.',
  );
}

export async function chargeMemberFee(
  _prev: ActionResult<MemberFeeRow> | null,
  formData: FormData,
): Promise<ActionResult<MemberFeeRow>> {
  const user = await requireUser();
  if (!can(user, 'fees.collect')) {
    return { ok: false, error: 'You do not have permission to charge fees.' };
  }

  const parsed = z
    .object({
      member_id: z.string().uuid(),
      fee_id: z.string().uuid({ message: 'Choose a fee.' }),
      reason: z.string().trim().min(3, 'Say what this charge is for.').max(300),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('charge_member_fee', {
    p_member_id: parsed.data.member_id,
    p_fee_id: parsed.data.fee_id,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error);

  revalidateMember(parsed.data.member_id);
  const charge = data as MemberFeeRow;
  return succeed(charge, `${charge.fee_name} charged.`);
}

export async function waiveMemberFee(
  _prev: ActionResult<MemberFeeRow> | null,
  formData: FormData,
): Promise<ActionResult<MemberFeeRow>> {
  const user = await requireUser();
  if (!can(user, 'fees.manage')) {
    return { ok: false, error: 'You do not have permission to waive fees.' };
  }

  const parsed = z
    .object({
      member_id: z.string().uuid(),
      charge_id: z.string().uuid(),
      reason: z.string().trim().min(5, 'Give a reason of at least five characters.').max(500),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('waive_member_fee', {
    p_charge_id: parsed.data.charge_id,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, 'reason');

  revalidateMember(parsed.data.member_id);
  const charge = data as MemberFeeRow;
  return succeed(charge, `${charge.fee_name} waived.`);
}
