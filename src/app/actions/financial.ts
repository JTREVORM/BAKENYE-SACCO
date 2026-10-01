'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';

/**
 * Financial server actions.
 *
 * Every one of these is a thin wrapper: validate the shape of the form, then
 * call the matching SECURITY DEFINER function in `0002_functions.sql`. The
 * money arithmetic, the permission check, the audit entry and the atomicity all
 * live in Postgres. That is deliberate — it means these guarantees hold for any
 * caller, not just for requests that happen to come through this file.
 *
 * Each action carries an `idempotency_key` from the form. A double tap, a
 * retried request on a dropped 3G connection, or a browser replaying a POST all
 * resolve to the same single ledger row.
 */

const money = z.coerce
  .number({ invalid_type_error: 'Enter an amount.' })
  .positive('Enter an amount greater than zero.')
  .max(99_999_999_999, 'That amount is too large.');

const uuid = z.string().uuid('Please select a valid record.');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
  .refine((d) => new Date(`${d}T12:00:00`) <= new Date(Date.now() + 86_400_000), {
    message: 'The date cannot be in the future.',
  });

function firstIssue(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0] ?? '') };
}

/** Revalidates every surface a money movement can appear on. */
function revalidateFinancial(memberId?: string | null) {
  revalidatePath('/', 'layout');
  revalidatePath('/staff');
  revalidatePath('/staff/transactions');
  revalidatePath('/transactions');
  if (memberId) revalidatePath(`/staff/members/${memberId}`);
}

/* ==========================================================================
 * MEMBER MONEY — MOVED
 *
 * `buyShares`, `recordSavings`, `recordCashMovement` and `recordRepayment` used
 * to live here, each taking a `method` from its own hard-coded list of four and
 * letting the database guess which account the money landed in. They are gone:
 * every one of those screens now posts to `recordMemberCollection` in
 * `actions/treasury.ts`, which carries the account the operator chose down to
 * `record_member_collection()`. One action, one account rule, one place to
 * change it. The member-side database functions they called - `buy_shares`,
 * `record_savings_payment`, `record_cash_movement`, `record_loan_repayment` -
 * are unchanged and still do the member side of the work.
 *
 * `disburseLoan` has moved the same way, as collection type
 * `loan_disbursement`, so a disbursement names the account the money leaves.
 * ======================================================================== */

/* ==========================================================================
 * LOAN LIFECYCLE
 * ======================================================================== */

export async function setLoanStatus(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ loan_no: string; status: string }>> {
  const user = await requireUser();

  const parsed = z
    .object({
      loan_id: uuid,
      status: z.enum(['under_review', 'approved', 'rejected']),
      reason: z.string().trim().max(1000).optional(),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const needed = parsed.data.status === 'approved' ? 'loans.approve' : 'loans.assess';
  if (!can(user, needed)) {
    return { ok: false, error: 'You do not have permission to make this decision.' };
  }

  if (parsed.data.status === 'rejected' && !parsed.data.reason?.trim()) {
    return { ok: false, error: 'Please give a reason for the rejection.', field: 'reason' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_loan_status', {
    p_loan_id: parsed.data.loan_id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) return fail(error, 'reason');

  revalidateFinancial();
  revalidatePath('/staff/loans');
  revalidatePath(`/staff/loans/${parsed.data.loan_id}`);
  revalidatePath('/loans');

  const result = data as { loan_no: string; status: string };
  const verb = { under_review: 'moved to review', approved: 'approved', rejected: 'declined' }[
    parsed.data.status
  ];
  return succeed(result, `Loan ${result.loan_no} ${verb}.`);
}

/* ==========================================================================
 * LOAN APPLICATION
 * ======================================================================== */

const guarantorSchema = z.object({
  member_id: uuid,
  amount: z.coerce.number().positive(),
});

export async function applyForLoan(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ loan_id: string; loan_no: string }>> {
  const user = await requireUser();

  const raw = Object.fromEntries(formData);
  const parsed = z
    .object({
      member_id: uuid,
      product_id: uuid,
      principal: money,
      period_months: z.coerce.number().int().min(1).max(120),
      purpose: z.string().trim().min(5, 'Describe what the loan is for.').max(1000),
      purpose_category: z.string().trim().max(100).optional(),
      guarantors: z.string().optional(),
      idempotency_key: z.string().min(8),
    })
    .safeParse(raw);

  if (!parsed.success) return firstIssue(parsed.error);

  // A member may only apply for themselves.
  if (!can(user, 'loans.assess') && user.memberId !== parsed.data.member_id) {
    return { ok: false, error: 'You may only apply for a loan on your own membership.' };
  }

  let guarantors: z.infer<typeof guarantorSchema>[] = [];
  if (parsed.data.guarantors) {
    let raw: unknown;
    try {
      raw = JSON.parse(parsed.data.guarantors);
    } catch {
      return { ok: false, error: 'One of the guarantors is not valid.', field: 'guarantors' };
    }
    const list = z.array(guarantorSchema).safeParse(raw);
    if (!list.success) {
      return { ok: false, error: 'One of the guarantors is not valid.', field: 'guarantors' };
    }
    guarantors = list.data;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apply_for_loan', {
    p_member_id: parsed.data.member_id,
    p_product_id: parsed.data.product_id,
    p_principal: parsed.data.principal,
    p_period_months: parsed.data.period_months,
    p_purpose: parsed.data.purpose,
    p_purpose_category: parsed.data.purpose_category ?? null,
    p_guarantors: guarantors,
    p_idempotency_key: parsed.data.idempotency_key,
  });

  if (error) return fail(error);

  revalidatePath('/loans');
  revalidatePath('/staff/loans');

  const result = data as { loan_id: string; loan_no: string; duplicate: boolean };
  return succeed(
    result,
    result.duplicate
      ? `Your application ${result.loan_no} was already submitted.`
      : `Application ${result.loan_no} submitted.`,
  );
}

/* ==========================================================================
 * GUARANTORS
 * ======================================================================== */

export async function respondToGuarantee(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ status: string }>> {
  await requireUser();

  const parsed = z
    .object({
      guarantor_id: uuid,
      status: z.enum(['accepted', 'declined', 'released']),
      note: z.string().trim().max(500).optional(),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_guarantor_status', {
    p_guarantor_id: parsed.data.guarantor_id,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  });

  if (error) return fail(error);

  revalidatePath('/guarantees');
  revalidatePath('/staff/loans');

  const result = data as { status: string };
  return succeed(result, `Guarantee ${result.status}.`);
}

export async function removeGuarantor(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ removed: boolean }>> {
  const user = await requireUser();
  if (!can(user, 'guarantors.manage')) {
    return { ok: false, error: 'You do not have permission to remove guarantors.' };
  }

  const parsed = z
    .object({
      guarantor_id: uuid,
      reason: z.string().trim().min(3, 'Give a reason for removing this guarantor.').max(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('remove_guarantor', {
    p_guarantor_id: parsed.data.guarantor_id,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(error, 'reason');

  revalidatePath('/staff/loans');
  return succeed(data as { removed: boolean }, 'Guarantor removed.');
}

/* ==========================================================================
 * EXPENSE APPROVAL
 * ======================================================================== */

/*
 * `recordIncome` and `recordExpense` were here too, each with its own
 * hard-coded four-method list and no account. The Finance screens they served
 * now use `recordOtherReceipt` and `recordExpenseRequest` in
 * `actions/treasury.ts`, which name the account the money is received into or
 * paid out of. Only the approval step, which moves no money of its own, stays.
 */

export async function approveExpense(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ approval: string }>> {
  const user = await requireUser();
  if (!can(user, 'finance.approve')) {
    return { ok: false, error: 'You do not have permission to approve expenses.' };
  }

  const parsed = z
    .object({
      expense_id: uuid,
      approve: z.enum(['true', 'false']).transform((v) => v === 'true'),
      reason: z.string().trim().max(500).optional(),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  if (!parsed.data.approve && !parsed.data.reason?.trim()) {
    return { ok: false, error: 'Give a reason for rejecting this expense.', field: 'reason' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('approve_expense', {
    p_expense_id: parsed.data.expense_id,
    p_approve: parsed.data.approve,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) return fail(error, 'reason');

  revalidatePath('/staff/finance');
  revalidateFinancial();

  const result = data as { approval: string };
  return succeed(result, `Expense ${result.approval}.`);
}

/* ==========================================================================
 * REVERSALS
 * ======================================================================== */

export async function reverseTransaction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ reversal_reference: string; original_reference: string }>> {
  const user = await requireUser();
  if (!can(user, 'transactions.reverse')) {
    return { ok: false, error: 'You do not have permission to reverse transactions.' };
  }

  const parsed = z
    .object({
      transaction_id: uuid,
      reason: z
        .string()
        .trim()
        .min(10, 'Give a clear reason — this is recorded permanently in the audit log.')
        .max(1000),
      reversal_date: isoDate
        .optional()
        .or(z.literal(''))
        .transform((v) => (v ? v : undefined)),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('reverse_transaction', {
    p_transaction_id: parsed.data.transaction_id,
    p_reason: parsed.data.reason,
    p_reversal_date: parsed.data.reversal_date ?? null,
  });

  if (error) return fail(error, 'reason');

  revalidateFinancial();
  revalidatePath('/staff/audit');
  revalidatePath('/staff/finance', 'layout');

  const result = data as { reversal_reference: string; original_reference: string };
  return succeed(
    result,
    `${result.original_reference} reversed by ${result.reversal_reference}.`,
  );
}
