/**
 * Database types.
 *
 * Hand-maintained to match `supabase/migrations/`. Once the project is linked
 * you can regenerate with:
 *
 *   npx supabase gen types typescript --linked > src/types/db.ts
 *
 * Keep the domain aliases at the bottom either way - the app imports those.
 */

import type {
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceDocStatus,
  TransferKind,
  TreasuryFunctions,
  TreasuryTables,
  TreasuryViews,
} from './treasury';
import type { AccessFunctions, AccessTables } from './access';

/**
 * A role key. Roles are rows in `roles` (0029), so a Super Admin can add one
 * without a deployment; the key is therefore a string, not a closed union.
 */
export type UserRole = string;
/**
 * `exited` survives only in history: enum values cannot be dropped, and a
 * member who leaves is now `archived`.
 */
export type MemberStatus = 'pending' | 'active' | 'inactive' | 'suspended' | 'archived' | 'exited';
export type SavingsKind = 'weekly' | 'monthly';
/**
 * The state of one member's savings month.
 *
 * Only `paid` (money went in) and `pending` (none did) are ever set on a new
 * row. `partial` and `missed` survive on rows raised under the old savings
 * targets, and `waived` on months a manager closed before 0044 retired
 * waivers. None of the three is raised again.
 */
export type SavingsStatus = 'paid' | 'partial' | 'pending' | 'missed' | 'waived';

/**
 * A category is either in use or retired. Categories were retired wholesale by
 * migration 0043 — savings are open and every share costs the same — and the
 * rows are kept, inactive, so a record raised under one can still name it.
 */
export type CategoryStatus = 'active' | 'inactive';

/** How often a savings record covers. Monthly is what the SACCO collects. */
export type SavingsFrequency = SavingsKind;

/**
 * The payment seam. Phase One writes 'manual' only — no gateway is called and
 * no provider confirmation is ever fabricated.
 */
export type PaymentProvider =
  | 'manual' | 'mtn_momo' | 'airtel_money' | 'flutterwave' | 'pesapal' | 'bank';
export type PaymentState = 'pending' | 'processing' | 'successful' | 'failed' | 'cancelled';

export type LoanStatus =
  | 'applied' | 'under_review' | 'approved' | 'rejected'
  | 'disbursed' | 'active' | 'completed' | 'defaulted' | 'written_off';
export type GuarantorStatus = 'pending' | 'accepted' | 'declined' | 'released';
export type TxnType =
  | 'share_purchase' | 'weekly_savings' | 'monthly_savings' | 'loan_disbursement'
  | 'loan_repayment' | 'deposit' | 'withdrawal' | 'income' | 'expense' | 'fee' | 'penalty'
  /** Money moving between two of the SACCO's own accounts. Never income or expense. */
  | 'transfer'
  /** Money paid out that is not an operating expense - a refund, a dividend. */
  | 'payment';
export type TxnStatus = 'posted' | 'reversed' | 'reversal';
export type PaymentMethod = 'cash' | 'mobile_money' | 'bank_transfer' | 'cheque' | 'internal';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type AppUserRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  photo_url: string | null;
  is_active: boolean;
  last_login_at: string | null;
  /** When the account holder last chose their own password; null until they have. */
  password_set_at: string | null;
  /** On a temporary password that must be changed at next sign-in. */
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
};

export type MemberRow = {
  id: string;
  member_no: string;
  user_id: string | null;
  full_name: string;
  phone: string;
  email: string | null;
  national_id: string | null;
  date_of_birth: string | null;
  gender: string | null;
  address: string | null;
  occupation: string | null;
  next_of_kin_name: string | null;
  next_of_kin_phone: string | null;
  next_of_kin_relation: string | null;
  photo_url: string | null;
  status: MemberStatus;
  joined_on: string;
  share_category_id: string | null;
  savings_category_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** When the member last became active; null while pending. */
  activated_at: string | null;
  /** Set only by a permissioned, audited override. */
  allow_shared_phone: boolean;
  shared_phone_reason: string | null;
};

export type TransactionRow = {
  id: string;
  reference: string;
  member_id: string | null;
  type: TxnType;
  status: TxnStatus;
  amount: number;
  method: PaymentMethod;
  occurred_on: string;
  description: string | null;
  loan_id: string | null;
  savings_id: string | null;
  share_lot_id: string | null;
  income_id: string | null;
  expense_id: string | null;
  reverses_id: string | null;
  reversed_by_id: string | null;
  reversal_reason: string | null;
  external_ref: string | null;
  idempotency_key: string | null;
  recorded_by: string | null;
  created_at: string;
  /** The SACCO account money left - an expense, a payment, a transfer's source. */
  source_account_id: string | null;
  /** The SACCO account money arrived in - a collection, a transfer's destination. */
  destination_account_id: string | null;
};

export type ShareLotRow = {
  id: string;
  member_id: string;
  quantity: number;
  unit_price: number;
  total_value: number;
  purchased_on: string;
  transaction_id: string | null;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type SavingsPeriodRow = {
  id: string;
  member_id: string;
  kind: SavingsKind;
  period_start: string;
  period_end: string;
  period_label: string;
  expected_amount: number;
  paid_amount: number;
  status: SavingsStatus;
  savings_category_id: string | null;
  due_on: string | null;
  created_at: string;
  updated_at: string;
};

export type SavingsPaymentRow = {
  id: string;
  period_id: string;
  schedule_id: string | null;
  external_ref: string | null;
  note: string | null;
  member_id: string;
  savings_category_id: string | null;
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  transaction_id: string | null;
  recorded_by: string | null;
  created_at: string;
};

/**
 * A per-member savings target. Historical: nothing reads these rows any more
 * and `set_savings_plan()` refuses to write one, because savings are open.
 */
export type SavingsPlanRow = {
  id: string;
  member_id: string;
  kind: SavingsKind;
  target_amount: number;
  active_from: string;
  active_to: string | null;
  created_at: string;
};

export type InterestMethod = 'flat' | 'reducing';

/** How often a repayment falls due. A term is still agreed in months. */
export type RepaymentFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

/** What a late-payment penalty is charged on. */
export type PenaltyBasis = 'overdue' | 'installment' | 'outstanding';

export const REPAYMENT_FREQUENCY_LABELS: Record<RepaymentFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
};

export const PENALTY_BASIS_LABELS: Record<PenaltyBasis, string> = {
  overdue: 'The overdue amount',
  installment: 'The installment',
  outstanding: 'The whole outstanding balance',
};

export const INTEREST_METHOD_LABELS: Record<InterestMethod, string> = {
  flat: 'Flat rate',
  reducing: 'Reducing balance',
};

/**
 * A loan product, in full.
 *
 * Everything a loan is priced and granted on lives here rather than in code, so
 * a new product is a form a manager fills in. The eligibility fields all treat
 * zero as "no requirement", which is what lets the checks read as a list of
 * conditions rather than a thicket of null handling.
 */
export type LoanProductRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  category: string | null;

  interest_rate: number;
  interest_method: InterestMethod;

  min_amount: number;
  max_amount: number;
  min_period_months: number;
  max_period_months: number;
  repayment_frequency: RepaymentFrequency;

  processing_fee_pct: number;
  insurance_fee_pct: number;
  application_fee: number;
  late_penalty_pct: number;
  penalty_basis: PenaltyBasis;
  grace_period_days: number;

  min_savings_balance: number;
  min_savings_multiple: number;
  min_membership_months: number;
  required_shares: number;
  requires_guarantors: boolean;
  min_guarantors: number;
  requires_collateral: boolean;
  collateral_notes: string | null;
  eligibility_notes: string | null;
  instructions: string | null;

  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

/** The payload `save_loan_product()` takes. `id` absent creates a product. */
export type LoanProductInput = Omit<
  LoanProductRow,
  'id' | 'created_at' | 'updated_at' | 'updated_by'
>;

/* --------------------------------------------------------------------------
 * The settings registry
 *
 * A setting describes itself — its category, label, help text, type, unit and
 * bounds — so the settings screen renders from the database rather than from a
 * hand-written form per value, and adding a setting is one INSERT.
 * ----------------------------------------------------------------------- */

export type SettingCategory =
  | 'financial'
  | 'loans'
  | 'members'
  | 'savings'
  | 'categories'
  | 'notifications'
  | 'security'
  | 'system'
  | 'treasury';

export type SettingValueType =
  | 'money'
  | 'number'
  | 'integer'
  | 'percent'
  | 'boolean'
  | 'text'
  | 'select'
  | 'multiselect';

/** A value as stored: a number, a flag, a string, or a list of strings. */
export type SettingValue = number | boolean | string | string[];

export type SettingOption = { value: string; label: string };

export type SystemSettingRow = {
  key: string;
  category: SettingCategory;
  label: string;
  description: string | null;
  value_type: SettingValueType;
  unit: string | null;
  value: SettingValue;
  default_value: SettingValue;
  min_value: number | null;
  max_value: number | null;
  options: SettingOption[] | null;
  /** Grave enough that the screen confirms the change before saving it. */
  is_critical: boolean;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
};

/**
 * The single-row organisation record.
 *
 * Everything on it used to be a string literal in the settings screen, or — in
 * the case of the registered name — a literal inside a database function, which
 * is why correcting it once needed its own migration.
 */
export type SaccoSettingsRow = {
  id: boolean;
  legal_name: string;
  short_name: string;
  motto: string;
  registration_no: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  notify_in_app: boolean;
  updated_at: string;
  updated_by: string | null;
};

export type ShareSettingsRow = {
  id: boolean;
  unit_price: number;
  min_shares_on_join: number;
  updated_at: string;
};

export type LoanRow = {
  id: string;
  loan_no: string;
  member_id: string;
  product_id: string;
  principal: number;
  interest_rate: number;
  interest_method: string;
  interest_amount: number;
  processing_fee: number;
  total_payable: number;
  period_months: number;
  installment_amount: number;
  purpose: string;
  purpose_category: string | null;
  status: LoanStatus;
  applied_on: string;
  reviewed_on: string | null;
  approved_on: string | null;
  rejected_on: string | null;
  disbursed_on: string | null;
  first_due_on: string | null;
  completed_on: string | null;
  rejection_reason: string | null;
  review_notes: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  disbursed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LoanScheduleRow = {
  id: string;
  loan_id: string;
  installment_no: number;
  due_on: string;
  principal_due: number;
  interest_due: number;
  total_due: number;
  created_at: string;
};

export type LoanRepaymentRow = {
  id: string;
  loan_id: string;
  member_id: string;
  amount: number;
  principal_portion: number;
  interest_portion: number;
  paid_on: string;
  method: PaymentMethod;
  transaction_id: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type LoanGuarantorRow = {
  id: string;
  loan_id: string;
  member_id: string;
  guaranteed_amount: number;
  status: GuarantorStatus;
  responded_on: string | null;
  note: string | null;
  created_at: string;
};

export type LoanDocumentRow = {
  id: string;
  loan_id: string;
  label: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  is_system: boolean;
  /** Retired categories stay on history but are not offered for new entries. */
  is_active?: boolean;
  description?: string | null;
};

export type IncomeEntryRow = {
  id: string;
  category_id: string;
  amount: number;
  description: string | null;
  received_on: string;
  method: PaymentMethod;
  member_id: string | null;
  loan_id: string | null;
  transaction_id: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type ExpenseEntryRow = {
  id: string;
  category_id: string;
  /** Required for new Other requests; null on historical expenses. */
  custom_expense: string | null;
  amount: number;
  description: string | null;
  spent_on: string;
  method: PaymentMethod;
  attachment_path: string | null;
  approval: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  transaction_id: string | null;
  recorded_by: string | null;
  created_at: string;
  /** The account the money leaves when the expense is approved. */
  payment_account_id: string | null;
  /** EXP260912001 - an expense is numbered in the expense register's own series. */
  payment_no: string | null;
  payee: string | null;
  reference: string | null;
  notes: string | null;
  rejection_reason: string | null;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type AuditLogRow = {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: UserRole | null;
  action: string;
  module: string;
  record_id: string | null;
  summary: string | null;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  ip_address: string | null;
  created_at: string;
};

// --- The retired category registers ------------------------------------------
//
// Both tables were retired by migration 0043 and every row in them marked
// inactive. Nothing in the application reads them to decide an amount, price a
// share or classify a member; the shapes remain only so a historical record
// that names a tier can still resolve the name.

/** A row of the retired `share_categories` register. */
export type ShareCategoryTableRow = {
  id: string;
  code: string;
  name: string;
  required_shares: number;
  qualification_months: number | null;
  description: string | null;
  status: CategoryStatus;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** A row of the retired `savings_categories` register. */
export type SavingsCategoryRow = {
  id: string;
  code: string;
  name: string;
  amount: number;
  frequency: SavingsFrequency;
  description: string | null;
  status: CategoryStatus;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * `member_share_progress` — what one member holds, at the one share price.
 *
 * The name is kept because every caller asks for it, but there is no longer a
 * tier to make progress towards. `share_value` is what the lots actually cost;
 * `value_at_current_price` is what the same holding is worth at today's price.
 * They agree unless the price has moved since.
 */
export type MemberShareProgressRow = {
  member_id: string;
  shares_owned: number;
  share_value: number;
  /** The SACCO's one share price, or null if it cannot be read. */
  share_price: number | null;
  value_at_current_price: number | null;
  last_purchase_on: string | null;
};

/** `savings_transactions` — one posted savings payment, names resolved. */
export type SavingsTransactionRow = {
  id: string;
  member_id: string;
  member_no: string;
  member_name: string;
  schedule_id: string;
  period_id: string;
  /** The month the deposit was filed under — "Sep 2026". */
  cycle: string | null;
  amount: number;
  payment_method: PaymentMethod;
  reference: string;
  external_ref: string | null;
  transaction_date: string;
  note: string | null;
  transaction_id: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  created_at: string;
};

export type PaymentIntentRow = {
  id: string;
  reference: string;
  member_id: string | null;
  purpose: TxnType;
  amount: number;
  provider: PaymentProvider;
  method: PaymentMethod;
  state: PaymentState;
  provider_ref: string | null;
  provider_payload: unknown;
  failure_reason: string | null;
  schedule_id: string | null;
  loan_id: string | null;
  transaction_id: string | null;
  idempotency_key: string | null;
  initiated_by: string | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
};

// --- Views -----------------------------------------------------------------

/**
 * What `submission_status()` returns: whether the posting submitted under one
 * idempotency key landed, and what it became.
 *
 * `found: false` means nothing was posted under that key — the submission can
 * be made again with the same key. `found: true` means it landed, and
 * `reference` is the document number to show; if `reversed` is true it landed
 * and has since been reversed, so it is a reversal to explain rather than a
 * posting to retry. `amount` is a string for the same reason as elsewhere: a
 * shilling amount must not be rounded through a float.
 */
export type SubmissionStatus =
  | { found: false }
  | {
      found: true;
      status: TxnStatus;
      transaction_id: string;
      reference: string;
      type: TxnType;
      method: PaymentMethod;
      amount: string;
      occurred_on: string;
      recorded_at: string;
      description: string | null;
      receipt_no: string | null;
      reversed: boolean;
      reversal_reference: string | null;
    };

/**
 * What `member_register_totals()` returns: the member register's totals over
 * the complete filtered set, not over the page on screen (F-05).
 *
 * The money figures arrive as strings so a shilling amount is never rounded
 * through a float on the way to a screen. Put them through `toNumber()`.
 */
export type MemberRegisterTotals = {
  members: number;
  savings_balance: string;
  share_count: number;
  share_value: string;
  loan_balance: string;
  overdue_amount: string;
};

export type MemberFinancialsRow = {
  id: string;
  member_no: string;
  user_id: string | null;
  full_name: string;
  phone: string;
  email: string | null;
  national_id: string | null;
  photo_url: string | null;
  status: MemberStatus;
  joined_on: string;
  address: string | null;
  occupation: string | null;
  next_of_kin_name: string | null;
  next_of_kin_phone: string | null;
  next_of_kin_relation: string | null;
  date_of_birth: string | null;
  gender: string | null;
  savings_balance: number;
  weekly_total: number;
  monthly_total: number;
  deposits_total: number;
  withdrawals_total: number;
  share_count: number;
  share_value: number;
  loan_balance: number;
  overdue_amount: number;
  active_loans: number;
  pending_loans: number;
  next_due_on: string | null;
  next_due_amount: number | null;
  total_equity: number;

  /** Shares, at the SACCO's one price. */
  shares_owned: number;
  share_price: number | null;
  share_value_at_current_price: number | null;
  last_share_purchase_on: string | null;

  /** Saved since the first of this month, from the ledger. */
  savings_this_month: number;
  last_saved_on: string | null;
  /** Everything ever paid against a savings schedule. */
  savings_contributed: number;
};

/**
 * `savings_schedules` — one member, one month, and what they saved in it.
 *
 * There is no expected amount and nothing outstanding: savings are open, so a
 * row records what came in, not what should have.
 */
export type SavingsScheduleRow = {
  schedule_id: string;
  period_id: string;
  member_id: string;
  member_no: string;
  member_name: string;
  member_phone: string;
  member_photo: string | null;
  member_status: MemberStatus;
  kind: SavingsKind;
  period_start: string;
  period_end: string;
  period_label: string;
  /** The period label, under the name the collection screens use. */
  cycle: string;
  saved_amount: number;
  paid_amount: number;
  status: SavingsStatus;
  created_at: string;
  updated_at: string;
  last_method: PaymentMethod | null;
  last_reference: string | null;
  last_paid_on: string | null;
  last_transaction_id: string | null;
  /** How many posted deposits went into this month. */
  deposits: number;
};

export type LoanBalanceRow = {
  loan_id: string;
  loan_no: string;
  member_id: string;
  status: LoanStatus;
  principal: number;
  interest_amount: number;
  processing_fee: number;
  total_payable: number;
  installment_amount: number;
  period_months: number;
  disbursed_on: string | null;
  amount_paid: number;
  outstanding: number;
  percent_repaid: number;
  next_due_on: string | null;
  next_due_amount: number | null;
  overdue_amount: number;
  days_overdue: number | null;
};

export type TransactionFeedRow = {
  id: string;
  reference: string;
  member_id: string | null;
  member_no: string | null;
  member_name: string | null;
  member_photo: string | null;
  type: TxnType;
  status: TxnStatus;
  amount: number;
  method: PaymentMethod;
  occurred_on: string;
  description: string | null;
  loan_id: string | null;
  reverses_id: string | null;
  reversed_by_id: string | null;
  reversal_reason: string | null;
  created_at: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
  direction: 'debit' | 'credit';
  /** Expense type, including the specified Other type; absent in old fixtures. */
  expense_category_label?: string | null;
};

export type DashboardMetrics = {
  total_members: number;
  members_this_month: number;
  share_capital: number;
  total_savings: number;
  active_loan_count: number;
  active_loan_value: number;
  outstanding_loans: number;
  overdue_loans: number;
  overdue_count: number;
  pending_loans: number;
  todays_collections: number;
  income_mtd: number;
  expenses_mtd: number;
  pending_expenses: number;
  /** Shares issued, and what one costs today. */
  shares_issued: number;
  share_price: number | null;
  /** Savings taken since the first of the month, and by how many members. */
  savings_this_month: number;
  savers_this_month: number;
};

/**
 * What `quote_loan()` returns.
 *
 * The same function the application calls when it commits, so a member is
 * never quoted one interest amount and charged another.
 */
export type LoanQuote = {
  product_id: string;
  product_name: string;
  product_code: string;
  principal: number;
  interest_rate: number;
  interest_method: InterestMethod;
  interest_amount: number;

  processing_fee: number;
  insurance_fee: number;
  application_fee: number;
  total_fees: number;

  total_payable: number;
  period_months: number;
  repayment_frequency: RepaymentFrequency;
  installment_count: number;
  installment_amount: number;
  net_disbursed: number;

  late_penalty_pct: number;
  penalty_basis: PenaltyBasis;
  grace_period_days: number;
  requires_guarantors: boolean;
  min_guarantors: number;
  requires_collateral: boolean;
};

/**
 * What `loan_eligibility()` returns.
 *
 * `reasons` is every rule standing in the member's way, not the first one — a
 * member told to wait six months and then told they also need three shares has
 * been failed by the software rather than by the rule.
 */
export type LoanEligibility = {
  eligible: boolean;
  reasons: string[];
  savings_balance: number;
  share_count: number;
  /** The most this member may borrow given their savings; null means no cap. */
  borrowing_ceiling: number | null;
  max_amount: number;
  requires_guarantors: boolean;
  min_guarantors: number;
  guarantor_cover_pct: number;
  requires_collateral: boolean;
  collateral_notes: string | null;
  eligibility_notes: string | null;
};

export type StatementRow = {
  reference: string;
  occurred_on: string;
  type: TxnType;
  description: string | null;
  amount: number;
  method: PaymentMethod;
  status: TxnStatus;
  created_at: string;
  running_balance: number;
};

export type MemberStatement = {
  member: MemberFinancialsRow;
  from: string;
  to: string;
  opening_balance: number;
  rows: StatementRow[];
  generated_at: string;
};

/** Everything printed on a receipt, in one round trip. */
export type ReceiptPayload = {
  transaction: TransactionFeedRow;
  sacco_name: string;
  receipt_no: string;
  loan: {
    loan_no: string;
    outstanding: number;
    total_payable: number;
    next_due_on: string | null;
  } | null;
  shares: { quantity: number; unit_price: number; total_value: number } | null;
  balance_after: number;
  /** 'Membership Payment Receipt' / 'Fee Payment Receipt' for fee payments. */
  receipt_title?: string | null;
  /** What a fee payment paid for, line by line. Empty for anything else. */
  fee_lines?: { description: string; amount: number }[];
  /** The provider or bank reference typed when the payment was recorded. */
  external_ref?: string | null;
  /** Staff only: which of the SACCO's accounts the money left and arrived in. */
  source_account?: ReceiptAccount | null;
  destination_account?: ReceiptAccount | null;
  transfer?: {
    id: string;
    transfer_no: string;
    kind: TransferKind;
    source_reference: string | null;
    destination_reference: string | null;
    handled_by: string | null;
    status: FinanceDocStatus;
  } | null;
  payment?: {
    id: string;
    payment_no: string;
    payee: string;
    reference: string | null;
    status: FinanceDocStatus;
  } | null;
};

export type ReceiptAccount = { id: string; name: string; account_type: FinanceAccountType };

/**
 * `savings_performance()` — who saved, and how much, over a period.
 *
 * There is no target to measure anyone against, so the report counts deposits
 * and adds up what came in, taken from the ledger.
 */
export type SavingsPerformanceRow = {
  member_id: string;
  member_no: string;
  full_name: string;
  member_status: MemberStatus;
  deposits: number;
  total_saved: number;
  first_saved_on: string | null;
  last_saved_on: string | null;
  savings_balance: number;
};

export type LoanPortfolioRow = {
  id: string;
  loan_no: string;
  status: LoanStatus;
  principal: number;
  total_payable: number;
  interest_rate: number;
  period_months: number;
  applied_on: string;
  disbursed_on: string | null;
  purpose: string;
  amount_paid: number;
  outstanding: number;
  percent_repaid: number;
  next_due_on: string | null;
  overdue_amount: number;
  days_overdue: number | null;
  member_id: string;
  member_no: string;
  member_name: string;
  photo_url: string | null;
  product_name: string;
};

/**
 * `member_collection_view()` — everything the counter needs for one member, in
 * one round trip.
 *
 * `current` is this month's savings record; it is opened on demand if it does
 * not exist yet, so a member standing at the counter never produces an empty
 * screen. Nothing here says what the member owes, because nothing is owed.
 */
export type MemberCollectionView = {
  member: MemberFinancialsRow;
  current: SavingsScheduleRow | null;
  share_progress: MemberShareProgressRow | null;
  share_price: number | null;
  schedules: SavingsScheduleRow[];
  history: SavingsTransactionRow[];
  as_of: string;
};

/** `member_savings_overview()` — the member's own financial dashboard. */
export type MemberSavingsOverview = {
  member: MemberFinancialsRow;
  share_progress: MemberShareProgressRow | null;
  share_price: number | null;
  schedules: SavingsScheduleRow[];
  recent_payments: SavingsTransactionRow[];
  loans: {
    loan_id: string;
    loan_no: string;
    status: LoanStatus;
    principal: number;
    total_payable: number;
    amount_paid: number;
    outstanding: number;
    percent_repaid: number;
    next_due_on: string | null;
    next_due_amount: number | null;
    overdue_amount: number;
  }[];
  generated_at: string;
};

/** `savings_dashboard()` — what members saved, not what they owed. */
/** The Membership Fees module's summary cards. */
export type MembershipFeeDashboard = {
  /** What it currently costs to join, from the `fees` configuration. */
  fee_amount: number;
  collected_total: number;
  collected_month: number;
  collected_today: number;
  members_paid: number;
  members_partial: number;
  members_unpaid: number;
  members_waived: number;
  outstanding_total: number;
};

/** Where a member stands on the membership fee. */
export type MembershipFeeStatus = 'paid' | 'partial' | 'unpaid' | 'waived' | 'none';

/** One row of the Membership Fees table. */
export type MembershipFeeRow = {
  member_id: string;
  member_no: string;
  full_name: string;
  member_status: MemberStatus;
  registered_on: string | null;
  /** The sum of what this member was charged, at the amounts they were charged. */
  required_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  status: MembershipFeeStatus;
  last_payment_on: string | null;
  last_reference: string | null;
  last_receipt_no: string | null;
  /** Repeated on every row so one call can paginate. */
  total_count: number;
};

/** One charge making up a member's membership fee. */
export type MembershipFeeCharge = {
  charge_id: string;
  fee_name: string;
  charged_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  status: 'unpaid' | 'partial' | 'paid' | 'waived';
  charged_on: string;
  charge_reason: string | null;
};

/** One payment against a member's membership fee. */
export type MembershipFeePayment = {
  paid_on: string;
  amount: number;
  reference: string | null;
  external_ref: string | null;
  receipt_no: string | null;
  method: PaymentMethod;
  /** A reversed payment stays listed, and counts towards nothing. */
  transaction_status: TxnStatus;
  fee_name: string;
};

/** One member's membership fee, for the profile card and the collect dialog. */
export type MemberMembershipFee = {
  member_id: string;
  member_no: string;
  full_name: string;
  member_status: MemberStatus;
  registered_on: string | null;
  required_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  status: MembershipFeeStatus;
  last_payment_on: string | null;
  fee_amount: number;
  charges: MembershipFeeCharge[];
  payments: MembershipFeePayment[];
};

export type SavingsDashboard = {
  from: string;
  to: string;
  total_members: number;
  /** Lifetime savings held by the SACCO, from the ledger. */
  total_savings: number;
  /** The window in view. */
  collected_savings: number;
  deposit_count: number;
  saving_members: number;
  largest_deposit: number;
  average_deposit: number;
  collected_today: number;
  savers_today: number;
};

export type CashbookLine = { category: string; total: number; entries: number };

export type Cashbook = {
  from: string;
  to: string;
  income: CashbookLine[];
  expenses: CashbookLine[];
  total_income: number;
  total_expenses: number;
  net_surplus: number;
};

// --- Supabase client generic ----------------------------------------------

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type View<Row> = { Row: Row; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      app_users: Table<AppUserRow>;
      members: Table<MemberRow>;
      transactions: Table<TransactionRow>;
      share_lots: Table<ShareLotRow>;
      share_settings: Table<ShareSettingsRow>;
      sacco_settings: Table<SaccoSettingsRow>;
      system_settings: Table<SystemSettingRow>;
      savings_plans: Table<SavingsPlanRow>;
      savings_periods: Table<SavingsPeriodRow>;
      savings_payments: Table<SavingsPaymentRow>;
      loan_products: Table<LoanProductRow>;
      loans: Table<LoanRow>;
      loan_schedule: Table<LoanScheduleRow>;
      loan_repayments: Table<LoanRepaymentRow>;
      loan_guarantors: Table<LoanGuarantorRow>;
      loan_documents: Table<LoanDocumentRow>;
      income_categories: Table<CategoryRow>;
      expense_categories: Table<CategoryRow>;
      income_entries: Table<IncomeEntryRow>;
      expense_entries: Table<ExpenseEntryRow>;
      notifications: Table<NotificationRow>;
      audit_logs: Table<AuditLogRow>;
      share_categories: Table<ShareCategoryTableRow>;
      savings_categories: Table<SavingsCategoryRow>;
      payment_intents: Table<PaymentIntentRow>;
    } & TreasuryTables & AccessTables;
    Views: {
      member_financials: View<MemberFinancialsRow>;
      member_savings: View<{ member_id: string; weekly_total: number; monthly_total: number; deposits_total: number; withdrawals_total: number; savings_balance: number }>;
      member_shares: View<{ member_id: string; share_count: number; share_value: number; last_purchase_on: string | null }>;
      member_loans_summary: View<{ member_id: string; active_loans: number; pending_loans: number; loan_balance: number; overdue_amount: number; next_due_on: string | null; next_due_amount: number | null }>;
      loan_balances: View<LoanBalanceRow>;
      transaction_feed: View<TransactionFeedRow>;
      savings_schedules: View<SavingsScheduleRow>;
      savings_transactions: View<SavingsTransactionRow>;
      member_share_progress: View<MemberShareProgressRow>;
    } & TreasuryViews;
    /**
     * RPC signatures.
     *
     * Spelled out rather than left as an index signature, so a typo in an
     * argument name — `p_memberid` instead of `p_member_id` — is a compile
     * error rather than a runtime `null` that books a transaction against
     * nobody.
     */
    Functions: {
      /** Register totals over every member the filter selects (F-05). */
      member_register_totals: {
        Args: { p_status?: MemberStatus | null };
        Returns: MemberRegisterTotals;
      };
      /**
       * What became of the posting made under this idempotency key - the
       * read-only answer to an uncertain submission (migration 0050). Never
       * posts, reverses or repairs anything.
       */
      submission_status: {
        Args: { p_idempotency_key: string };
        Returns: SubmissionStatus;
      };
      buy_shares: {
        Args: {
          p_member_id: string;
          p_quantity: number;
          p_method?: PaymentMethod;
          p_purchased_on?: string;
          p_note?: string | null;
          p_idempotency_key?: string | null;
          /**
           * The total the form showed. The database multiplies quantity by its
           * own price and refuses the sale if the two disagree, so a total
           * computed in the browser can never decide what is charged.
           */
          p_expected_total?: number | null;
        };
        Returns: {
          transaction_id: string;
          reference: string;
          share_lot_id: string;
          quantity: number;
          unit_price: number;
          total_value: number;
        };
      };
      record_savings_payment: {
        Args: {
          p_member_id: string;
          p_kind: SavingsKind;
          p_amount: number;
          p_paid_on?: string;
          p_method?: PaymentMethod;
          p_idempotency_key?: string | null;
        };
        Returns: {
          transaction_id: string;
          reference: string;
          payment_id: string;
          period_id: string;
          schedule_id: string;
          period_label: string;
          /** What the member has saved in this month, after this deposit. */
          paid: number;
          period_total: number;
          status: SavingsStatus;
        };
      };
      record_cash_movement: {
        Args: {
          p_member_id: string;
          p_type: TxnType;
          p_amount: number;
          p_method?: PaymentMethod;
          p_occurred_on?: string;
          p_description?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: { transaction_id: string; reference: string; amount: number; type: TxnType };
      };
      record_loan_repayment: {
        Args: {
          p_loan_id: string;
          p_amount: number;
          p_paid_on?: string;
          p_method?: PaymentMethod;
          p_idempotency_key?: string | null;
        };
        Returns: {
          transaction_id: string;
          reference: string;
          repayment_id: string;
          amount: number;
          total_paid: number;
          outstanding: number;
          completed: boolean;
          next_due_on: string | null;
        };
      };
      quote_loan: {
        Args: { p_product_id: string; p_principal: number; p_period_months: number };
        Returns: LoanQuote;
      };
      apply_for_loan: {
        Args: {
          p_member_id: string;
          p_product_id: string;
          p_principal: number;
          p_period_months: number;
          p_purpose: string;
          p_purpose_category?: string | null;
          p_guarantors?: { member_id: string; amount: number }[];
          p_idempotency_key?: string | null;
        };
        Returns: {
          loan_id: string;
          loan_no: string;
          status: LoanStatus;
          quote?: LoanQuote;
          duplicate: boolean;
        };
      };
      set_loan_status: {
        Args: { p_loan_id: string; p_status: LoanStatus; p_reason?: string | null };
        Returns: { loan_id: string; loan_no: string; status: LoanStatus };
      };
      disburse_loan: {
        Args: {
          p_loan_id: string;
          p_method?: PaymentMethod;
          p_disbursed_on?: string;
          p_idempotency_key?: string | null;
        };
        Returns: {
          loan_id: string;
          loan_no: string;
          status: LoanStatus;
          reference: string;
          transaction_id: string;
          first_due_on: string;
        };
      };
      set_guarantor_status: {
        Args: { p_guarantor_id: string; p_status: GuarantorStatus; p_note?: string | null };
        Returns: { guarantor_id: string; status: GuarantorStatus };
      };
      remove_guarantor: {
        Args: { p_guarantor_id: string; p_reason: string };
        Returns: { removed: boolean };
      };
      record_income: {
        Args: {
          p_category_id: string;
          p_amount: number;
          p_description: string;
          p_received_on?: string;
          p_method?: PaymentMethod;
          p_member_id?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: { transaction_id: string; reference: string; income_id: string };
      };
      record_expense: {
        Args: {
          p_category_id: string;
          p_amount: number;
          p_description: string;
          p_spent_on?: string;
          p_method?: PaymentMethod;
          p_attachment_path?: string | null;
          p_idempotency_key?: string | null;
          /** The account the money will leave once the expense is approved. */
          p_payment_account_id?: string | null;
          p_payee?: string | null;
          p_reference?: string | null;
          p_notes?: string | null;
          p_custom_expense?: string | null;
        };
        Returns: {
          expense_id: string;
          approval: ApprovalStatus;
          payment_no: string | null;
          duplicate: boolean;
        };
      };
      approve_expense: {
        Args: { p_expense_id: string; p_approve: boolean; p_reason?: string | null };
        Returns: { expense_id: string; approval: ApprovalStatus; reference: string | null };
      };
      reverse_transaction: {
        Args: { p_transaction_id: string; p_reason: string; p_reversal_date?: string | null };
        Returns: { original_reference: string; reversal_reference: string; reversal_id: string };
      };
      set_member_status: {
        Args: { p_member_id: string; p_status: MemberStatus; p_reason: string };
        Returns: { member_id: string; status: MemberStatus };
      };
      set_user_role: {
        Args: { p_user_id: string; p_role: UserRole; p_reason: string };
        Returns: { user_id: string; role: UserRole };
      };
      set_user_active: {
        Args: { p_user_id: string; p_active: boolean; p_reason: string };
        Returns: { user_id: string; is_active: boolean };
      };
      dashboard_metrics: { Args: Record<PropertyKey, never>; Returns: DashboardMetrics };
      collections_trend: {
        Args: { p_months?: number };
        Returns: {
          bucket: string;
          label: string;
          savings: number;
          repayments: number;
          shares: number;
        }[];
      };
      member_statement: {
        Args: { p_member_id: string; p_from: string; p_to: string };
        Returns: MemberStatement;
      };
      cashbook: { Args: { p_from: string; p_to: string }; Returns: Cashbook };
      search_members: {
        Args: {
          p_query?: string | null;
          p_status?: MemberStatus | null;
          p_sort?: string;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: { rows: MemberFinancialsRow[]; total: number; limit: number; offset: number };
      };
      /** The loans the caller guarantees, with the borrower named (0042). */
      my_guarantees: {
        Args: { p_member_id?: string | null };
        Returns: {
          guarantee_id: string;
          guaranteed_amount: number;
          guarantee_status: GuarantorStatus;
          responded_on: string | null;
          requested_on: string;
          loan_id: string;
          loan_no: string;
          loan_status: LoanStatus;
          principal: number;
          total_payable: number | null;
          outstanding: number | null;
          percent_repaid: number | null;
          applied_on: string;
          disbursed_on: string | null;
          next_due_on: string | null;
          purpose: string | null;
          borrower_name: string;
          borrower_no: string;
          borrower_photo: string | null;
        }[];
      };
      search_guarantor_candidates: {
        Args: { p_query: string; p_exclude_member: string; p_loan_id?: string | null };
        Returns: {
          id: string;
          member_no: string;
          full_name: string;
          phone: string;
          photo_url: string | null;
          savings_balance: number;
          share_value: number;
        }[];
      };
      receipt_for_transaction: { Args: { p_transaction_id: string }; Returns: ReceiptPayload };
      savings_performance: {
        Args: {
          p_from: string;
          p_to: string;
        };
        Returns: SavingsPerformanceRow[];
      };
      loan_portfolio: {
        Args: {
          p_status?: LoanStatus | null;
          p_from?: string | null;
          p_to?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: { rows: LoanPortfolioRow[]; total: number; limit: number; offset: number };
      };
      open_savings_periods: { Args: { p_kind: SavingsKind; p_on?: string }; Returns: number };
      /** The SACCO's one share price, from `share_settings`. */
      share_unit_price: { Args: Record<PropertyKey, never>; Returns: number | null };
      /* --- Savings and collection ------------------------------------------ */
      /**
       * Kept so the "open this period" control keeps working, and now a no-op:
       * savings are open, so there is no schedule to raise.
       */
      open_savings_schedules: {
        Args: { p_on?: string };
        Returns: { date: string; schedules: number; opened: boolean; message: string };
      };
      /**
       * The one call the collection screen makes. Manual by design: it records
       * a payment that already happened, it does not initiate one.
       */
      record_scheduled_savings: {
        Args: {
          p_schedule_id: string;
          p_amount: number;
          p_paid_on?: string;
          p_method?: PaymentMethod;
          p_external_ref?: string | null;
          p_note?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: {
          transaction_id: string;
          reference: string;
          payment_id: string;
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
      };
      /**
       * Everything the counter needs for one member. Opens this month's savings
       * record on demand, so a member at the counter never produces an empty
       * screen.
       */
      member_collection_view: {
        Args: { p_member_id: string; p_on?: string };
        Returns: MemberCollectionView;
      };
      /** The member's own financial dashboard — savings, shares and loans. */
      member_savings_overview: {
        Args: { p_member_id: string };
        Returns: MemberSavingsOverview;
      };
      savings_dashboard: {
        Args: { p_from?: string | null; p_to?: string | null };
        Returns: SavingsDashboard;
      };

      /* --- Configuration (0014) --------------------------------------------
       * Every one of these is `SECURITY DEFINER` and re-checks
       * `can_manage_settings()` in the database, so the permission check in the
       * server action is a courtesy to the UI, not the thing that holds. */
      update_organisation_settings: {
        Args: {
          p_legal_name: string;
          p_short_name: string;
          p_motto: string;
          p_registration_no?: string | null;
          p_contact_email?: string | null;
          p_contact_phone?: string | null;
          p_address?: string | null;
        };
        Returns: SaccoSettingsRow;
      };
      update_savings_defaults: {
        Args: {
          p_default_weekly_target: number;
          p_default_monthly_target: number;
        };
        Returns: SaccoSettingsRow;
      };
      update_notification_settings: {
        Args: { p_notify_in_app: boolean };
        Returns: SaccoSettingsRow;
      };
      update_share_settings: {
        Args: { p_unit_price: number; p_min_shares_on_join: number };
        Returns: ShareSettingsRow;
      };

      /**
       * Public branding only — name, short name and motto.
       *
       * Granted to `anon` so the sign-in screen can name the SACCO before
       * anyone has signed in. Deliberately excludes the address, registration
       * number and contact details.
       */
      sacco_public_brand: {
        Args: Record<string, never>;
        Returns: {
          legal_name: string;
          short_name: string;
          motto: string;
          contact_email: string | null;
          contact_phone: string | null;
        };
      };

      /* --- Configuration registry (0015 / 0016) --- */

      /** Every setting as one object, keyed by setting key. */
      settings_map: {
        Args: Record<string, never>;
        Returns: Record<string, SettingValue>;
      };
      /**
       * Apply a batch of settings changes.
       *
       * Validated as a whole and applied in one transaction, so a bad sixth
       * field cannot leave the first five saved.
       */
      update_settings: {
        Args: { p_changes: Record<string, SettingValue>; p_reason?: string | null };
        Returns: { changed: string[] };
      };
      reset_setting: {
        Args: { p_key: string; p_reason?: string | null };
        Returns: { changed: string[] };
      };

      /* --- Loan products and eligibility (0017 / 0018) --- */

      /** Creates when `p_product_id` is null, edits when it is not. */
      save_loan_product: {
        Args: {
          p_product_id: string | null;
          p_payload: Partial<LoanProductInput>;
          p_reason?: string | null;
        };
        Returns: LoanProductRow;
      };
      loan_eligibility: {
        Args: { p_member_id: string; p_product_id: string; p_principal?: number | null };
        Returns: LoanEligibility;
      };
      create_loan_product: {
        Args: {
          p_name: string;
          p_code: string;
          p_interest_rate: number;
          p_interest_method: 'flat' | 'reducing';
          p_min_amount: number;
          p_max_amount: number;
          p_min_period_months: number;
          p_max_period_months: number;
          p_processing_fee_pct?: number;
          p_min_guarantors?: number;
          p_description?: string | null;
          p_is_active?: boolean;
        };
        Returns: LoanProductRow;
      };
      update_loan_product: {
        Args: {
          p_product_id: string;
          p_name: string;
          p_code: string;
          p_interest_rate: number;
          p_interest_method: 'flat' | 'reducing';
          p_min_amount: number;
          p_max_amount: number;
          p_min_period_months: number;
          p_max_period_months: number;
          p_processing_fee_pct?: number;
          p_min_guarantors?: number;
          p_description?: string | null;
        };
        Returns: LoanProductRow;
      };
      set_loan_product_active: {
        Args: { p_product_id: string; p_is_active: boolean; p_reason?: string | null };
        Returns: LoanProductRow;
      };

      mark_notifications_read: { Args: { p_ids?: string[] | null }; Returns: number };
      run_daily_maintenance: {
        Args: Record<PropertyKey, never>;
        Returns: {
          periods_marked_missed: number;
          loans_defaulted: number;
          schedules_opened: {
            date: string;
            schedules: number;
            weekly: number;
            monthly: number;
            uncategorised: number;
          };
        };
      };
    } & TreasuryFunctions & AccessFunctions;
    Enums: {
      user_role: UserRole;
      member_status: MemberStatus;
      savings_kind: SavingsKind;
      savings_status: SavingsStatus;
      loan_status: LoanStatus;
      guarantor_status: GuarantorStatus;
      txn_type: TxnType;
      txn_status: TxnStatus;
      payment_method: PaymentMethod;
      approval_status: ApprovalStatus;
      category_status: CategoryStatus;
      payment_provider: PaymentProvider;
      payment_state: PaymentState;
      finance_account_type: FinanceAccountType;
      finance_account_status: FinanceAccountStatus;
      finance_doc_status: FinanceDocStatus;
      transfer_kind: TransferKind;
    };
    CompositeTypes: Record<string, never>;
  };
};
