'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can, type Permission } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import { formatUGX } from '@/lib/money';
import { CUSTOM_EXPENSE_MAX_LENGTH, isOtherExpenseCategory } from '@/lib/expenses';
import type {
  CollectionType,
  FinanceDocumentRow,
  MemberCollectionResult,
  OtherReceiptResult,
  PaymentResult,
  ReconciliationResult,
  TransferResult,
} from '@/types/treasury';

/**
 * Server actions for Cash at Merchant, Cash at Bank and Cash at Hand.
 *
 * Each one validates the shape of the form and calls one SECURITY DEFINER
 * function from `0027_cash_and_bank.sql`. The account arithmetic, the
 * zero-balance rule, the approval rules, the duplicate-reference checks, the
 * audit entry and the atomicity all live in Postgres, so they hold for any
 * caller - the permission check here is a courtesy to the screen, not the
 * thing that protects the money.
 *
 * PHASE ONE IS MANUAL. A provider reference typed into these forms is
 * recorded as typed. Nothing here contacts MTN, Airtel, a bank or a gateway.
 */

/* --------------------------------------------------------------------------
 * Shared validation
 * ----------------------------------------------------------------------- */

const money = z.coerce
  .number({ invalid_type_error: 'Enter an amount.' })
  .positive('Enter an amount greater than zero.')
  .max(99_999_999_999, 'That amount is too large.');

const uuid = z.string().uuid('Please choose a valid record.');

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal(''))
  .transform((v) => (v ? v : undefined));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .transform((v) => (v ? v : undefined));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
  .refine((d) => new Date(`${d}T12:00:00`) <= new Date(Date.now() + 86_400_000), {
    message: 'The date cannot be in the future.',
  });

const method = z
  .enum(['cash', 'mobile_money', 'bank_transfer', 'cheque'])
  .optional()
  .or(z.literal(''))
  .transform((v) => (v ? v : undefined));

const idempotencyKey = z.string().min(8).max(120);

function firstIssue(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0] ?? '') };
}

/** Everything money can show up on. */
function refreshFinance() {
  revalidatePath('/staff/finance', 'layout');
  revalidatePath('/staff');
  revalidatePath('/staff/transactions');
}

/* --------------------------------------------------------------------------
 * Supporting documents
 *
 * Written to the private `finance-documents` bucket as the signed-in user, so
 * the bucket's own policy decides whether they may; then recorded against the
 * transfer, payment or expense by `attach_finance_document()`, which audits
 * it. A document that fails to upload never undoes the money entry it
 * supports - it is reported, and can be attached again from the register.
 * ----------------------------------------------------------------------- */

const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The browser's declared type is only a label. Check the file's first bytes
 * really are the PDF or image it claims to be, so a renamed web page or script
 * cannot be stored among the SACCO's receipts.
 */
async function matchesSignature(file: File): Promise<boolean> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  switch (file.type) {
    case 'application/pdf':
      return ascii(0, 5) === '%PDF-';
    case 'image/jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return b[0] === 0x89 && ascii(1, 4) === 'PNG';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    default:
      return false;
  }
}

async function attachDocument(
  ownerType: FinanceDocumentRow['owner_type'],
  ownerId: string,
  file: FormDataEntryValue | null,
): Promise<string | null> {
  if (!file || typeof file === 'string' || file.size === 0) return null;

  if (file.size > DOCUMENT_MAX_BYTES) {
    return 'The supporting document is larger than 5 MB and was not attached.';
  }
  if (!DOCUMENT_TYPES.includes(file.type) || !(await matchesSignature(file))) {
    return 'The supporting document must be a PDF or a photo (JPEG, PNG or WebP). It was not attached.';
  }

  const supabase = await createClient();
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'document';
  const path = `${ownerType}s/${ownerId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from('finance-documents')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    return 'The entry was saved, but the supporting document could not be uploaded. Attach it again from the register.';
  }

  const { error } = await supabase.rpc('attach_finance_document', {
    p_owner_type: ownerType,
    p_owner_id: ownerId,
    p_storage_path: path,
    p_file_name: file.name,
    p_mime_type: file.type,
    p_size_bytes: file.size,
  });
  if (error) {
    return 'The entry was saved, but the supporting document could not be recorded. Attach it again from the register.';
  }
  return null;
}

/* ==========================================================================
 * Member collections
 * ======================================================================== */

/**
 * What each kind of money movement needs the operator to be allowed to do.
 *
 * The same mapping `record_member_collection()` checks in the database, where it
 * is authoritative; this copy only refuses earlier, with the message the rest of
 * the application uses. A role that may record repayments but not savings - a
 * Loan Officer - is allowed through here exactly as the database allows it.
 */
const COLLECTION_PERMISSION: Record<CollectionType, Permission> = {
  savings: 'savings.record',
  shares: 'shares.sell',
  loan_repayment: 'loans.repay',
  deposit: 'cash.movement',
  withdrawal: 'cash.movement',
  loan_disbursement: 'loans.disburse',
  fee: 'finance.record',
};

const COLLECTION_NOUN: Record<CollectionType, string> = {
  savings: 'savings',
  shares: 'share purchases',
  loan_repayment: 'loan repayments',
  deposit: 'deposits',
  withdrawal: 'withdrawals',
  loan_disbursement: 'loan disbursements',
  fee: 'fee collections',
};

const collectionSchema = z.object({
  member_id: uuid,
  collection_type: z.enum(
    [
      'savings',
      'shares',
      'loan_repayment',
      'deposit',
      'fee',
      'withdrawal',
      'loan_disbursement',
    ],
    { errorMap: () => ({ message: 'Choose what the member is paying for.' }) },
  ),
  amount: money,
  /**
   * The account the money goes into, or out of. Chosen from the SACCO's own
   * active accounts - there is no "payment method" list anywhere in the
   * application any more.
   */
  account_id: z.string().uuid('Choose the account the money was received into.'),
  paid_on: isoDate,
  method,
  external_ref: optionalText(80),
  description: optionalText(500),
  notes: optionalText(500),
  savings_kind: z
    .enum(['weekly', 'monthly'])
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined)),
  loan_id: optionalUuid,
  income_category_id: optionalUuid,
  /** A savings collection screen settles a named month and passes it. */
  period_id: optionalUuid,
  /** What the share counter showed, so a price that moved mid-sale refuses it. */
  quantity: z.coerce
    .number()
    .int()
    .positive()
    .max(100_000)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? undefined : Number(v))),
  idempotency_key: idempotencyKey,
});

/**
 * Every shilling a member hands over, and every shilling handed back.
 *
 * One server action behind every counter screen - savings, shares, membership
 * and other fees, loan repayments, deposits, withdrawals and disbursements - so
 * none of them can grow its own idea of where money goes. The member side is
 * done by the function that has always done it; what this adds is the account,
 * and the account is a row the SACCO configured, not an option typed into a
 * form.
 */
export async function recordMemberCollection(
  _prev: ActionResult<MemberCollectionResult> | null,
  formData: FormData,
): Promise<ActionResult<MemberCollectionResult>> {
  const user = await requireUser();

  const parsed = collectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  if (!can(user, COLLECTION_PERMISSION[d.collection_type])) {
    return {
      ok: false,
      error: `You do not have permission to record ${COLLECTION_NOUN[d.collection_type]}.`,
    };
  }

  if (d.collection_type === 'fee' && !d.income_category_id) {
    return { ok: false, error: 'Choose what the fee is for.', field: 'income_category_id' };
  }
  if (d.collection_type === 'loan_disbursement' && !d.loan_id) {
    return { ok: false, error: 'Name the loan being disbursed.', field: 'loan_id' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('record_member_collection', {
    p_member_id: d.member_id,
    p_collection_type: d.collection_type,
    p_amount: d.amount,
    p_account_id: d.account_id,
    p_paid_on: d.paid_on,
    p_method: d.method ?? null,
    p_external_ref: d.external_ref ?? null,
    p_description: d.description ?? null,
    p_notes: d.notes ?? null,
    p_savings_kind: d.savings_kind ?? null,
    p_loan_id: d.loan_id ?? null,
    p_income_category_id: d.income_category_id ?? null,
    p_idempotency_key: d.idempotency_key,
    p_period_id: d.period_id ?? null,
    p_quantity: d.quantity ?? null,
  });

  if (error) return fail(error, 'amount');

  const result = data as unknown as MemberCollectionResult;
  refreshFinance();
  revalidatePath('/', 'layout');
  revalidatePath(`/staff/members/${d.member_id}`);
  revalidatePath('/staff/savings', 'layout');
  revalidatePath('/staff/shares');
  revalidatePath('/staff/loans', 'layout');
  revalidatePath('/staff/membership-fees');
  if (d.loan_id) revalidatePath(`/staff/loans/${d.loan_id}`);
  // The member's own portal reads the same ledger.
  revalidatePath('/savings');
  revalidatePath('/shares');
  revalidatePath('/loans', 'layout');
  revalidatePath('/transactions');

  return succeed(result, collectionMessage(result));
}

/** Plain English for what just happened, in the direction it happened. */
function collectionMessage(r: MemberCollectionResult): string {
  const receipt = r.receipt_no ? ` Receipt ${r.receipt_no}.` : '';
  if (r.direction === 'out') {
    return `${formatUGX(r.amount)} paid to ${r.member_name} out of ${r.account_name}.${receipt}`;
  }
  return (
    `${formatUGX(r.amount)} received from ${r.member_name} into ${r.account_name}.` + receipt
  );
}

/* ==========================================================================
 * Other receipts
 * ======================================================================== */

const otherReceiptSchema = z.object({
  account_id: z.string().uuid('Choose the account the money was received into.'),
  category_id: z.string().uuid('Choose an income category.'),
  amount: money,
  received_on: isoDate,
  payer_name: optionalText(160),
  member_id: optionalUuid,
  method,
  reference: optionalText(80),
  description: optionalText(500),
  idempotency_key: idempotencyKey,
});

export async function recordOtherReceipt(
  _prev: ActionResult<OtherReceiptResult> | null,
  formData: FormData,
): Promise<ActionResult<OtherReceiptResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.record')) {
    return { ok: false, error: 'You do not have permission to record receipts.' };
  }

  const parsed = otherReceiptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  if (!d.member_id && !d.payer_name) {
    return { ok: false, error: 'Enter who paid.', field: 'payer_name' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('record_other_receipt', {
    p_account_id: d.account_id,
    p_category_id: d.category_id,
    p_amount: d.amount,
    p_received_on: d.received_on,
    p_payer_name: d.payer_name ?? null,
    p_member_id: d.member_id ?? null,
    p_method: d.method ?? null,
    p_reference: d.reference ?? null,
    p_description: d.description ?? null,
    p_idempotency_key: d.idempotency_key,
  });

  if (error) return fail(error, 'amount');

  const result = data as unknown as OtherReceiptResult;
  refreshFinance();
  return succeed(
    result,
    `Receipt ${result.receipt_no ?? result.reference} recorded into ${result.account_name}.`,
  );
}

/* ==========================================================================
 * Internal transfers
 * ======================================================================== */

const transferSchema = z.object({
  source_account_id: z.string().uuid('Choose the account the money leaves.'),
  destination_account_id: z.string().uuid('Choose the account the money goes to.'),
  amount: money,
  transfer_date: isoDate,
  source_reference: optionalText(80),
  destination_reference: optionalText(80),
  description: optionalText(500),
  purpose: optionalText(300),
  handled_by: optionalText(120),
  notes: optionalText(1000),
  intent: z.enum(['submit', 'draft']).default('submit'),
  idempotency_key: idempotencyKey,
});

export type TransferActionResult = TransferResult & { reference: string };

export async function createTransfer(
  _prev: ActionResult<TransferActionResult> | null,
  formData: FormData,
): Promise<ActionResult<TransferActionResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.record')) {
    return { ok: false, error: 'You do not have permission to record transfers.' };
  }

  const parsed = transferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  if (d.source_account_id === d.destination_account_id) {
    return { ok: false, error: 'Choose two different accounts.', field: 'destination_account_id' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_internal_transfer', {
    p_source_account_id: d.source_account_id,
    p_destination_account_id: d.destination_account_id,
    p_amount: d.amount,
    p_transfer_date: d.transfer_date,
    p_source_reference: d.source_reference ?? null,
    p_destination_reference: d.destination_reference ?? null,
    p_description: d.description ?? null,
    p_purpose: d.purpose ?? null,
    p_handled_by: d.handled_by ?? null,
    p_notes: d.notes ?? null,
    p_submit: d.intent === 'submit',
    p_idempotency_key: d.idempotency_key,
  });

  if (error) return fail(error, 'amount');

  const result = data as unknown as TransferResult;
  const warning = result.duplicate ? null : await attachDocument('transfer', result.id, formData.get('document'));
  refreshFinance();

  const message =
    result.status === 'completed'
      ? `${result.transfer_no} completed. ${result.source_account} now holds ${formatUGX(result.source_balance)}; ${result.destination_account} holds ${formatUGX(result.destination_balance)}.`
      : result.status === 'draft'
        ? `${result.transfer_no} saved as a draft. No money has moved.`
        : `${result.transfer_no} submitted for approval. No money moves until a manager approves it.`;

  return succeed(
    { ...result, reference: result.transfer_no },
    warning ? `${message} ${warning}` : message,
  );
}

const decisionSchema = z.object({
  id: uuid,
  approve: z.enum(['true', 'false']).transform((v) => v === 'true'),
  reason: optionalText(500),
});

export async function decideTransfer(
  _prev: ActionResult<TransferResult> | null,
  formData: FormData,
): Promise<ActionResult<TransferResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.approve')) {
    return { ok: false, error: 'You do not have permission to approve transfers.' };
  }
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  if (!parsed.data.approve && !parsed.data.reason) {
    return { ok: false, error: 'Give a reason for rejecting this transfer.', field: 'reason' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decide_internal_transfer', {
    p_id: parsed.data.id,
    p_approve: parsed.data.approve,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return fail(error, 'reason');

  const result = data as unknown as TransferResult;
  refreshFinance();
  return succeed(
    result,
    parsed.data.approve
      ? `${result.transfer_no} approved. ${formatUGX(result.amount)} moved from ${result.source_account} to ${result.destination_account}.`
      : `${result.transfer_no} rejected. No money moved.`,
  );
}

const cancelSchema = z.object({
  id: uuid,
  reason: z.string().trim().min(3, 'Give a reason for cancelling.').max(500),
});

export async function cancelTransfer(
  _prev: ActionResult<TransferResult> | null,
  formData: FormData,
): Promise<ActionResult<TransferResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.record')) {
    return { ok: false, error: 'You do not have permission to cancel transfers.' };
  }
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cancel_internal_transfer', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, 'reason');

  const result = data as unknown as TransferResult;
  refreshFinance();
  return succeed(result, `${result.transfer_no} cancelled. No money moved.`);
}

export async function submitTransfer(
  _prev: ActionResult<TransferResult> | null,
  formData: FormData,
): Promise<ActionResult<TransferResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.record')) {
    return { ok: false, error: 'You do not have permission to submit transfers.' };
  }
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_internal_transfer', { p_id: parsed.data.id });
  if (error) return fail(error);

  const result = data as unknown as TransferResult;
  refreshFinance();
  return succeed(
    result,
    result.status === 'completed'
      ? `${result.transfer_no} submitted and completed.`
      : `${result.transfer_no} submitted for approval.`,
  );
}

/* ==========================================================================
 * Payments
 * ======================================================================== */

const paymentSchema = z.object({
  payee: z.string().trim().min(2, 'Enter who is being paid.').max(160),
  category_id: z.string().uuid('Choose a payment category.'),
  amount: money,
  account_id: z.string().uuid('Choose the account the payment is made from.'),
  payment_date: isoDate,
  member_id: optionalUuid,
  method,
  reference: optionalText(80),
  description: z.string().trim().min(3, 'Describe what the payment is for.').max(500),
  notes: optionalText(1000),
  intent: z.enum(['submit', 'draft']).default('submit'),
  idempotency_key: idempotencyKey,
});

export type PaymentActionResult = PaymentResult & { reference: string };

export async function createPayment(
  _prev: ActionResult<PaymentActionResult> | null,
  formData: FormData,
): Promise<ActionResult<PaymentActionResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.record')) {
    return { ok: false, error: 'You do not have permission to record payments.' };
  }
  const parsed = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_payment', {
    p_payee: d.payee,
    p_category_id: d.category_id,
    p_amount: d.amount,
    p_account_id: d.account_id,
    p_payment_date: d.payment_date,
    p_member_id: d.member_id ?? null,
    p_method: d.method ?? null,
    p_reference: d.reference ?? null,
    p_description: d.description,
    p_notes: d.notes ?? null,
    p_submit: d.intent === 'submit',
    p_idempotency_key: d.idempotency_key,
  });
  if (error) return fail(error, 'amount');

  const result = data as unknown as PaymentResult;
  const warning = result.duplicate ? null : await attachDocument('payment', result.id, formData.get('document'));
  refreshFinance();

  const message =
    result.status === 'completed'
      ? `${result.payment_no} paid from ${result.account}, which now holds ${formatUGX(result.account_balance)}.`
      : result.status === 'draft'
        ? `${result.payment_no} saved as a draft. No money has moved.`
        : `${result.payment_no} submitted for approval. No money moves until a manager approves it.`;

  return succeed({ ...result, reference: result.payment_no }, warning ? `${message} ${warning}` : message);
}

export async function decidePayment(
  _prev: ActionResult<PaymentResult> | null,
  formData: FormData,
): Promise<ActionResult<PaymentResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.approve')) {
    return { ok: false, error: 'You do not have permission to approve payments.' };
  }
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  if (!parsed.data.approve && !parsed.data.reason) {
    return { ok: false, error: 'Give a reason for rejecting this payment.', field: 'reason' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decide_payment', {
    p_id: parsed.data.id,
    p_approve: parsed.data.approve,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return fail(error, 'reason');

  const result = data as unknown as PaymentResult;
  refreshFinance();
  return succeed(
    result,
    parsed.data.approve
      ? `${result.payment_no} approved and paid from ${result.account}.`
      : `${result.payment_no} rejected. No money moved.`,
  );
}

export async function cancelPayment(
  _prev: ActionResult<PaymentResult> | null,
  formData: FormData,
): Promise<ActionResult<PaymentResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.record')) {
    return { ok: false, error: 'You do not have permission to cancel payments.' };
  }
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cancel_payment', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, 'reason');

  const result = data as unknown as PaymentResult;
  refreshFinance();
  return succeed(result, `${result.payment_no} cancelled. No money moved.`);
}

export async function submitPayment(
  _prev: ActionResult<PaymentResult> | null,
  formData: FormData,
): Promise<ActionResult<PaymentResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.record')) {
    return { ok: false, error: 'You do not have permission to submit payments.' };
  }
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_payment', { p_id: parsed.data.id });
  if (error) return fail(error);

  const result = data as unknown as PaymentResult;
  refreshFinance();
  return succeed(
    result,
    result.status === 'completed'
      ? `${result.payment_no} submitted and paid.`
      : `${result.payment_no} submitted for approval.`,
  );
}

/* ==========================================================================
 * Expenses
 *
 * Filing an expense is a request: nothing leaves an account until it is
 * approved. The form now names the account it will be paid from.
 * ======================================================================== */

const expenseSchema = z.object({
  category_id: z.string().uuid('Choose an expense category.'),
  custom_expense: optionalText(CUSTOM_EXPENSE_MAX_LENGTH),
  amount: money,
  description: z.string().trim().min(3, 'Describe this expense.').max(500),
  spent_on: isoDate,
  payment_account_id: z.string().uuid('Choose the account this expense is paid from.'),
  method,
  payee: optionalText(160),
  reference: optionalText(80),
  notes: optionalText(1000),
  idempotency_key: idempotencyKey,
});

export type ExpenseActionResult = {
  expense_id: string;
  payment_no: string | null;
  reference: string;
};

export async function recordExpenseRequest(
  _prev: ActionResult<ExpenseActionResult> | null,
  formData: FormData,
): Promise<ActionResult<ExpenseActionResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.record')) {
    return { ok: false, error: 'You do not have permission to record expenses.' };
  }
  const parsed = expenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  // Resolve the category on the server; a submitted category name is untrusted.
  const { data: category, error: categoryError } = await supabase
    .from('expense_categories').select('name, is_active').eq('id', d.category_id).single();
  if (categoryError) return fail(categoryError, 'category_id');
  if (!category?.is_active) return { ok: false, error: 'Choose an expense category.', field: 'category_id' };
  const customExpense = isOtherExpenseCategory(category.name) ? d.custom_expense : undefined;
  if (isOtherExpenseCategory(category.name) && !customExpense) {
    return { ok: false, error: 'Specify expense when choosing Other.', field: 'custom_expense' };
  }
  const { data, error } = await supabase.rpc('record_expense', {
    p_category_id: d.category_id,
    p_amount: d.amount,
    p_description: d.description,
    p_spent_on: d.spent_on,
    p_method: d.method,
    p_attachment_path: null,
    p_idempotency_key: d.idempotency_key,
    p_payment_account_id: d.payment_account_id,
    p_payee: d.payee ?? null,
    p_reference: d.reference ?? null,
    p_notes: d.notes ?? null,
    p_custom_expense: customExpense ?? null,
  });
  if (error) return fail(error, 'amount');

  const result = data as { expense_id: string; payment_no: string | null; duplicate: boolean };
  const warning = result.duplicate
    ? null
    : await attachDocument('expense', result.expense_id, formData.get('document'));
  refreshFinance();

  const message = `Expense ${result.payment_no ?? ''} submitted for approval. No money has left the SACCO yet.`;
  return succeed(
    { expense_id: result.expense_id, payment_no: result.payment_no, reference: result.payment_no ?? '' },
    warning ? `${message} ${warning}` : message,
  );
}

/* ==========================================================================
 * Reconciliation
 * ======================================================================== */

const reconciliationSchema = z.object({
  account_id: z.string().uuid('Choose the account.'),
  reconciliation_date: isoDate,
  actual_balance: z.coerce
    .number({ invalid_type_error: 'Enter the actual balance.' })
    .min(0, 'Enter the actual balance.')
    .max(99_999_999_999, 'That amount is too large.'),
  reason: optionalText(1000),
  statement_reference: optionalText(120),
  notes: optionalText(1000),
});

export type ReconciliationActionResult = ReconciliationResult & { reference: string };

export async function recordReconciliation(
  _prev: ActionResult<ReconciliationActionResult> | null,
  formData: FormData,
): Promise<ActionResult<ReconciliationActionResult>> {
  const user = await requireUser();
  if (!can(user, 'finance.reconcile')) {
    return { ok: false, error: 'You do not have permission to reconcile accounts.' };
  }
  // An empty money field posts "", which would coerce to zero - a count of
  // nothing is not the same as not having counted.
  if (!String(formData.get('actual_balance') ?? '').trim()) {
    return { ok: false, error: 'Enter the actual balance.', field: 'actual_balance' };
  }
  const parsed = reconciliationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('record_reconciliation', {
    p_account_id: d.account_id,
    p_reconciliation_date: d.reconciliation_date,
    p_actual_balance: d.actual_balance,
    p_reason: d.reason ?? null,
    p_statement_reference: d.statement_reference ?? null,
    p_notes: d.notes ?? null,
  });
  if (error) return fail(error, 'reason');

  const result = data as unknown as ReconciliationResult;
  const warning = await attachDocument('reconciliation', result.id, formData.get('document'));
  refreshFinance();

  const message =
    result.outcome === 'reconciled'
      ? `${result.reconciliation_no}: reconciled. The actual balance matches the system.`
      : `${result.reconciliation_no}: variance of ${formatUGX(result.variance)} recorded with its reason. The system balance was not changed.`;
  return succeed(
    { ...result, reference: result.reconciliation_no },
    warning ? `${message} ${warning}` : message,
  );
}

/* ==========================================================================
 * Attaching a document later
 * ======================================================================== */

export async function attachFinanceDocument(
  _prev: ActionResult<{ attached: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ attached: boolean }>> {
  const user = await requireUser();
  if (!can(user, 'finance.record')) {
    return { ok: false, error: 'You do not have permission to attach documents.' };
  }
  const parsed = z
    .object({
      owner_type: z.enum(['transfer', 'payment', 'expense', 'reconciliation']),
      owner_id: uuid,
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const file = formData.get('document');
  if (!file || typeof file === 'string' || file.size === 0) {
    return { ok: false, error: 'Choose a file to attach.', field: 'document' };
  }

  const warning = await attachDocument(parsed.data.owner_type, parsed.data.owner_id, file);
  if (warning) return { ok: false, error: warning };

  refreshFinance();
  return succeed({ attached: true }, 'Document attached.');
}

/* ==========================================================================
 * Accounts and categories
 * ======================================================================== */

const accountSchema = z.object({
  id: optionalUuid,
  account_type: z.enum(['merchant', 'bank', 'cash']),
  name: z.string().trim().min(2, 'Enter a name for the account.').max(120),
  provider: optionalText(120),
  merchant_code: optionalText(60),
  account_identifier: optionalText(60),
  bank_name: optionalText(120),
  branch: optionalText(120),
  account_number: optionalText(60),
  opening_balance: z.coerce
    .number({ invalid_type_error: 'Enter the opening balance.' })
    .min(0, 'An opening balance cannot be negative.')
    .max(99_999_999_999)
    .default(0),
  opening_date: isoDate,
  description: optionalText(500),
  is_default: z
    .string()
    .optional()
    .transform((v) => v === 'on' || v === 'true'),
  reason: optionalText(500),
});

export async function saveFinancialAccount(
  _prev: ActionResult<{ id: string; name: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  const user = await requireUser();
  if (!can(user, 'finance.accounts')) {
    return { ok: false, error: 'You do not have permission to set up accounts.' };
  }
  const raw = Object.fromEntries(formData);
  if (raw.opening_balance === '') delete raw.opening_balance;
  const parsed = accountSchema.safeParse(raw);
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  if (d.account_type === 'merchant' && !d.provider) {
    return { ok: false, error: 'Enter the mobile money provider.', field: 'provider' };
  }
  if (d.account_type === 'bank' && (!d.bank_name || !d.account_number)) {
    return {
      ok: false,
      error: 'Enter the bank name and the account number.',
      field: d.bank_name ? 'account_number' : 'bank_name',
    };
  }

  const supabase = await createClient();
  const common = {
    p_name: d.name,
    p_provider: d.provider ?? null,
    p_merchant_code: d.merchant_code ?? null,
    p_account_identifier: d.account_identifier ?? null,
    p_bank_name: d.bank_name ?? null,
    p_branch: d.branch ?? null,
    p_account_number: d.account_number ?? null,
    p_opening_balance: d.opening_balance,
    p_opening_date: d.opening_date,
    p_description: d.description ?? null,
    p_is_default: d.is_default,
  };

  const { data, error } = d.id
    ? await supabase.rpc('update_financial_account', { p_id: d.id, ...common, p_reason: d.reason ?? null })
    : await supabase.rpc('create_financial_account', { p_account_type: d.account_type, ...common });

  if (error) return fail(error, 'name');

  refreshFinance();
  const result = data as { id: string; name: string };
  return succeed(result, d.id ? `${result.name} updated.` : `${result.name} created.`);
}

export async function setFinancialAccountStatus(
  _prev: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  const user = await requireUser();
  if (!can(user, 'finance.accounts')) {
    return { ok: false, error: 'You do not have permission to change an account.' };
  }
  const parsed = z
    .object({
      id: uuid,
      status: z.enum(['active', 'inactive', 'closed']),
      reason: z.string().trim().min(3, 'Give a reason - it is recorded in the audit log.').max(500),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_financial_account_status', {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, 'reason');

  refreshFinance();
  return succeed(data as { id: string; status: string }, `Account marked ${parsed.data.status}.`);
}

export async function saveFinanceCategory(
  _prev: ActionResult<{ id: string; name: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  const user = await requireUser();
  if (!can(user, 'finance.accounts')) {
    return { ok: false, error: 'You do not have permission to manage categories.' };
  }
  const parsed = z
    .object({
      kind: z.enum(['income', 'expense', 'payment']),
      id: optionalUuid,
      name: z.string().trim().min(2, 'Enter a name for the category.').max(80),
      description: optionalText(300),
      is_active: z
        .string()
        .optional()
        .transform((v) => v !== 'false'),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_finance_category', {
    p_kind: parsed.data.kind,
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_is_active: parsed.data.is_active,
  });
  if (error) return fail(error, 'name');

  refreshFinance();
  const result = data as { id: string; name: string };
  return succeed(result, `${result.name} saved.`);
}
