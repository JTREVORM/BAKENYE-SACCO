'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import type { LoanProductRow } from '@/types/db';

/**
 * Loan products.
 *
 * A product is the price list a loan is written against, so creating one is a
 * financial act: it decides what future borrowers are charged. Everything here
 * goes through `save_loan_product()`, which re-checks the permission, applies
 * the same validation, and writes an audit row naming who changed what.
 *
 * The validation below is deliberately a mirror of the database's, not a
 * substitute for it. It exists so an administrator sees "the longest term must
 * be at least the shortest term" against the field they typed it in, instead of
 * a round trip and a banner. The database's copy is the one that actually
 * holds, and it is the one that runs when someone calls the RPC directly.
 */

function firstIssue(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0]) };
}

/** Money and percentages arrive as strings, often with thousands separators. */
const numeric = (message: string) =>
  z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      const cleaned = v.replace(/[,\s]/g, '');
      return cleaned === '' ? undefined : Number(cleaned);
    },
    z.number({ invalid_type_error: message, required_error: message }),
  );

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

const productSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a name for the product.').max(80),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,10}$/, 'The code must be 2–10 capital letters or digits.'),
    description: optionalText(400),
    category: optionalText(60),

    interest_rate: numeric('Enter an interest rate.')
      .refine((v) => v >= 0, 'The interest rate cannot be negative.')
      .refine((v) => v <= 100, 'An interest rate above 100% a year is almost certainly a typo.'),
    interest_method: z.enum(['flat', 'reducing']),

    min_amount: numeric('Enter the smallest amount.').refine(
      (v) => v >= 0,
      'The smallest amount cannot be negative.',
    ),
    max_amount: numeric('Enter the largest amount a member may borrow.').refine(
      (v) => v > 0,
      'The largest amount must be greater than zero.',
    ),
    min_period_months: numeric('Enter the shortest term.')
      .refine((v) => Number.isInteger(v), 'The shortest term must be a whole number of months.')
      .refine((v) => v >= 1, 'The shortest term must be at least one month.'),
    max_period_months: numeric('Enter the longest term.')
      .refine((v) => Number.isInteger(v), 'The longest term must be a whole number of months.')
      .refine((v) => v >= 1, 'The longest term must be at least one month.'),
    repayment_frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),

    processing_fee_pct: numeric('Enter a processing fee, or zero.')
      .refine((v) => v >= 0, 'The processing fee cannot be negative.')
      .refine((v) => v <= 100, 'A processing fee above 100% is almost certainly a typo.'),
    insurance_fee_pct: numeric('Enter an insurance fee, or zero.')
      .refine((v) => v >= 0, 'The insurance fee cannot be negative.')
      .refine((v) => v <= 100, 'An insurance fee above 100% is almost certainly a typo.'),
    application_fee: numeric('Enter an application fee, or zero.').refine(
      (v) => v >= 0,
      'The application fee cannot be negative.',
    ),
    late_penalty_pct: numeric('Enter a late penalty, or zero.')
      .refine((v) => v >= 0, 'The late penalty cannot be negative.')
      .refine((v) => v <= 100, 'A late penalty above 100% is almost certainly a typo.'),
    penalty_basis: z.enum(['overdue', 'installment', 'outstanding']),
    grace_period_days: numeric('Enter a grace period, or zero.')
      .refine((v) => Number.isInteger(v), 'The grace period must be a whole number of days.')
      .refine((v) => v >= 0, 'The grace period cannot be negative.'),

    min_savings_balance: numeric('Enter a savings requirement, or zero.').refine(
      (v) => v >= 0,
      'The savings requirement cannot be negative.',
    ),
    min_savings_multiple: numeric('Enter a borrowing multiple, or zero.').refine(
      (v) => v >= 0,
      'The borrowing multiple cannot be negative.',
    ),
    min_membership_months: numeric('Enter a membership requirement, or zero.')
      .refine((v) => Number.isInteger(v), 'Enter a whole number of months.')
      .refine((v) => v >= 0, 'The membership requirement cannot be negative.'),
    required_shares: numeric('Enter a share requirement, or zero.')
      .refine((v) => Number.isInteger(v), 'Enter a whole number of shares.')
      .refine((v) => v >= 0, 'The share requirement cannot be negative.'),

    requires_guarantors: checkbox,
    min_guarantors: numeric('Enter how many guarantors are needed.')
      .refine((v) => Number.isInteger(v), 'Enter a whole number of guarantors.')
      .refine((v) => v >= 0, 'The number of guarantors cannot be negative.'),
    requires_collateral: checkbox,
    collateral_notes: optionalText(400),
    eligibility_notes: optionalText(600),
    instructions: optionalText(600),

    is_active: checkbox,
    sort_order: numeric('Enter a position.').refine(
      (v) => Number.isInteger(v) && v >= 0,
      'The position must be a whole number.',
    ),
  })
  // Cross-field rules. Each is attached to the field an administrator would fix,
  // so the message lands where the correction has to be made.
  .refine((d) => d.max_amount >= d.min_amount, {
    message: 'The largest amount must be at least the smallest amount.',
    path: ['max_amount'],
  })
  .refine((d) => d.max_period_months >= d.min_period_months, {
    message: 'The longest term must be at least the shortest term.',
    path: ['max_period_months'],
  })
  .refine((d) => d.grace_period_days <= d.max_period_months * 31, {
    message: 'The grace period cannot be longer than the longest term.',
    path: ['grace_period_days'],
  })
  .refine((d) => !d.requires_guarantors || d.min_guarantors >= 1, {
    message: 'This product requires guarantors, so enter how many are needed.',
    path: ['min_guarantors'],
  });

export async function saveLoanProduct(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string; created: boolean }>> {
  const user = await requireUser();
  if (!can(user.role, 'settings.manage')) {
    return { ok: false, error: 'You do not have permission to manage loan products.' };
  }

  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const productId = String(formData.get('product_id') ?? '').trim() || null;
  const reason = String(formData.get('reason') ?? '').trim();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_loan_product', {
    p_product_id: productId,
    p_payload: parsed.data,
    p_reason: reason === '' ? null : reason,
  });
  if (error) return fail(error, 'name');

  const product = data as unknown as LoanProductRow;

  // The product decides what an application is quoted, so the member-facing
  // apply flow is stale as well as the management screens.
  revalidatePath('/staff/loans/products');
  revalidatePath('/staff/settings');
  revalidatePath('/loans/apply');
  revalidatePath('/staff/loans/new');

  return succeed(
    { id: product.id, name: product.name, created: productId === null },
    productId === null
      ? `${product.name} created. It is now available to new applications.`
      : `${product.name} updated. Loans already written keep the terms they were agreed on.`,
  );
}

/**
 * Retire a product, or bring it back.
 *
 * There is no delete. Every loan ever written under a product references it,
 * and a financial record that cannot name the terms it was written on is not a
 * record. Retiring takes the product out of the application form and leaves the
 * history intact.
 */
export async function setLoanProductActive(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const user = await requireUser();
  if (!can(user.role, 'settings.manage')) {
    return { ok: false, error: 'You do not have permission to manage loan products.' };
  }

  const productId = String(formData.get('product_id') ?? '').trim();
  if (!productId) return { ok: false, error: 'No product was named.' };
  const active = String(formData.get('is_active') ?? '') === 'true';

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_loan_product_active', {
    p_product_id: productId,
    p_is_active: active,
    p_reason: String(formData.get('reason') ?? '').trim() || null,
  });
  if (error) return fail(error);

  revalidatePath('/staff/loans/products');
  revalidatePath('/staff/settings');
  revalidatePath('/loans/apply');

  return succeed(
    null,
    active
      ? 'Product restored. New applications may use it again.'
      : 'Product retired. Loans running under it are unaffected.',
  );
}
