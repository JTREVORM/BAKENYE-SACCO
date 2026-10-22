/**
 * Types for Cash at Merchant, Cash at Bank and Cash at Hand (migration 0027).
 *
 * Kept beside `db.ts` rather than inside it because the module is large and
 * self-contained; `db.ts` merges the tables, views and RPC signatures below
 * into the one `Database` type the Supabase client is generic over, so a
 * mistyped RPC argument here is still a compile error.
 */
import type { PaymentMethod, SavingsKind, TxnStatus, TxnType } from './db';

export type FinanceAccountType = 'merchant' | 'bank' | 'cash';
export type FinanceAccountStatus = 'active' | 'inactive' | 'closed';

/** The life of a transfer or payment. Money moves only on the step into `completed`. */
export type FinanceDocStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'reversed';

export type TransferKind = 'merchant_to_bank' | 'cash_to_bank' | 'bank_to_cash' | 'bank_to_bank';

/** What an account movement was, as `account_movements` classifies it. */
export type MovementClass =
  | 'collection'
  | 'other_receipt'
  | 'transfer_in'
  | 'transfer_out'
  | 'expense'
  | 'payment'
  | 'reversal';

/** What a member is paying for on the Record Collection form. */
/**
 * What a member's money movement is for. The first five are money the SACCO
 * receives; the last two are money it pays out. All seven go through the one
 * function, `record_member_collection()`, so the account a person chooses is the
 * account the ledger posts against, in either direction.
 */
export type CollectionType =
  | 'savings'
  | 'shares'
  | 'loan_repayment'
  | 'deposit'
  | 'fee'
  | 'withdrawal'
  | 'loan_disbursement';

/** The five that bring money in. Everything else pays money out. */
export const INCOMING_COLLECTION_TYPES = [
  'savings',
  'shares',
  'loan_repayment',
  'deposit',
  'fee',
] as const satisfies readonly CollectionType[];

export type FinancialAccountRow = {
  id: string;
  code: string;
  name: string;
  account_type: FinanceAccountType;
  provider: string | null;
  merchant_code: string | null;
  account_identifier: string | null;
  bank_name: string | null;
  branch: string | null;
  account_number: string | null;
  currency: string;
  opening_balance: number;
  opening_date: string;
  status: FinanceAccountStatus;
  is_default: boolean;
  description: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** An account with its balance derived from the ledger, never stored. */
export type FinancialAccountBalanceRow = Omit<FinancialAccountRow, 'created_by' | 'updated_by'> & {
  balance: number;
  entry_count: number;
  last_entry_at: string | null;
  last_reconciled_on: string | null;
  last_variance: number | null;
  last_actual_balance: number | null;
};

export type AccountLedgerEntryRow = {
  id: number;
  transaction_id: string;
  account_id: string;
  entry_date: string;
  debit: number;
  credit: number;
  /** Posting-order artefact — see `AccountMovementRow.balance_after` (F-15). */
  balance_after: number;
  created_by: string | null;
  created_at: string;
};

/** One account entry, classified, with a by-date running balance. */
export type AccountMovementRow = {
  entry_id: number;
  transaction_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: FinanceAccountType;
  entry_date: string;
  money_in: number;
  money_out: number;
  /**
   * DO NOT DISPLAY THIS, AND DO NOT RECONCILE AGAINST IT (F-15).
   *
   * A posting-order artefact, not the balance after this entry by value date.
   * `post_account_entry()` computes it from the most recent entry by `id` —
   * insertion order — and backdated entries are permitted, so for any account
   * that has one this value is not a chronological running balance. In the
   * seeded data 140 of 164 entries are out of date order and this column
   * visibly falls across successive money-in entries.
   *
   * Use `running_balance` below, which is a window function ordered by
   * `(entry_date, id)`. Every screen, statement, report and CSV already does.
   * The stored column is left alone because `account_ledger_entries` is
   * immutable by design; see the column comment in migration 0051.
   */
  balance_after: number;
  created_at: string;
  reference: string;
  txn_type: TxnType;
  txn_status: TxnStatus;
  method: PaymentMethod;
  description: string | null;
  external_ref: string | null;
  member_id: string | null;
  member_no: string | null;
  member_name: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  reverses_id: string | null;
  reversed_by_id: string | null;
  counter_account_type: FinanceAccountType | null;
  counter_account_name: string | null;
  movement_class: MovementClass;
  category_label: string;
  running_balance: number;
  custom_expense: string | null;
};

export type ReceiptRow = {
  id: string;
  receipt_no: string;
  transaction_id: string;
  payer_name: string | null;
  created_by: string | null;
  created_at: string;
};

export type ReceiptRegisterRow = {
  id: string;
  receipt_no: string;
  transaction_id: string;
  reference: string;
  receipt_date: string;
  amount: number;
  method: PaymentMethod;
  status: TxnStatus;
  txn_type: TxnType;
  member_id: string | null;
  member_no: string | null;
  member_name: string | null;
  payer: string | null;
  category: string;
  receiving_account_id: string | null;
  receiving_account_name: string | null;
  receiving_account_type: FinanceAccountType | null;
  reference_no: string | null;
  description: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  created_at: string;
};

export type InternalTransferRow = {
  id: string;
  transfer_no: string;
  kind: TransferKind;
  source_account_id: string;
  destination_account_id: string;
  amount: number;
  transfer_date: string;
  source_reference: string | null;
  destination_reference: string | null;
  description: string;
  purpose: string | null;
  handled_by: string | null;
  notes: string | null;
  status: FinanceDocStatus;
  requires_approval: boolean;
  transaction_id: string | null;
  reversal_transaction_id: string | null;
  idempotency_key: string | null;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  completed_at: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  updated_at: string;
};

export type TransferRegisterRow = InternalTransferRow & {
  source_account_name: string;
  source_account_type: FinanceAccountType;
  destination_account_name: string;
  destination_account_type: FinanceAccountType;
  created_by_name: string | null;
  approved_by_name: string | null;
  rejected_by_name: string | null;
  transaction_reference: string | null;
  reversal_reference: string | null;
  document_count: number;
};

export type PaymentCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  payment_no: string;
  payee: string;
  member_id: string | null;
  category_id: string;
  amount: number;
  payment_date: string;
  payment_account_id: string;
  method: PaymentMethod;
  reference: string | null;
  description: string;
  notes: string | null;
  status: FinanceDocStatus;
  requires_approval: boolean;
  transaction_id: string | null;
  reversal_transaction_id: string | null;
  idempotency_key: string | null;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  completed_at: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  updated_at: string;
};

/** Payments and expenses side by side, each with its own document number. */
export type PaymentRegisterRow = {
  source: 'payment' | 'expense';
  id: string;
  payment_no: string | null;
  payee: string | null;
  member_id: string | null;
  category_id: string;
  category: string;
  custom_expense: string | null;
  is_expense: boolean;
  amount: number;
  payment_date: string;
  payment_account_id: string | null;
  payment_account_name: string | null;
  payment_account_type: FinanceAccountType | null;
  method: PaymentMethod;
  reference: string | null;
  description: string | null;
  notes: string | null;
  status: FinanceDocStatus;
  requires_approval: boolean;
  created_by: string | null;
  created_by_name: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  rejection_reason: string | null;
  transaction_id: string | null;
  transaction_reference: string | null;
  created_at: string;
  document_count: number;
};

export type ReconciliationRow = {
  id: string;
  reconciliation_no: string;
  account_id: string;
  reconciliation_date: string;
  system_balance: number;
  actual_balance: number;
  variance: number;
  reason: string | null;
  statement_reference: string | null;
  notes: string | null;
  reconciled_by: string;
  created_at: string;
};

export type ReconciliationRegisterRow = ReconciliationRow & {
  account_name: string;
  account_type: FinanceAccountType;
  reconciled_by_name: string | null;
  outcome: 'reconciled' | 'variance';
};

export type FinanceDocumentRow = {
  id: string;
  owner_type: 'transfer' | 'payment' | 'expense' | 'reconciliation';
  owner_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
};

/* --------------------------------------------------------------------------
 * RPC payloads
 * ----------------------------------------------------------------------- */

/** Account movements grouped by what they were, for one day or a window. */
export type TreasuryMovement = {
  account_type: FinanceAccountType;
  movement_class: MovementClass;
  counter_account_type: FinanceAccountType | null;
  txn_type: TxnType;
  money_in: number;
  money_out: number;
  entries: number;
};

export type TreasurySummary = {
  as_of: string;
  accounts: FinancialAccountBalanceRow[];
  totals: { merchant: number; bank: number; cash: number; total: number };
  movements: TreasuryMovement[];
  pending: {
    transfers: number;
    transfers_amount: number;
    deposits: number;
    deposits_amount: number;
    payments: number;
    payments_amount: number;
    expenses: number;
    expenses_amount: number;
    drafts: number;
  };
  reversals_this_month: number;
  large_withdrawals: {
    id: string;
    transfer_no: string;
    amount: number;
    transfer_date: string;
    status: FinanceDocStatus;
  }[];
  unreconciled: {
    id: string;
    name: string;
    account_type: FinanceAccountType;
    last_reconciled_on: string | null;
  }[];
  variances: {
    id: string;
    name: string;
    account_type: FinanceAccountType;
    last_reconciled_on: string;
    variance: number;
  }[];
  thresholds: {
    merchant_balance_alert: number;
    cash_balance_alert: number;
    large_withdrawal_alert: number;
    reconciliation_overdue_days: number;
  };
};

export type CashBankReportAccount = {
  id: string;
  code: string;
  name: string;
  account_type: FinanceAccountType;
  status: FinanceAccountStatus;
  type_order: number;
  opening: number;
  money_in: number;
  money_out: number;
  closing: number;
};

export type CashBankReport = {
  from: string;
  to: string;
  accounts: CashBankReportAccount[];
  movements: (TreasuryMovement & { account_id: string; category_label: string })[];
  generated_at: string;
};

export type MonthlyFlowPoint = {
  bucket: string;
  label: string;
  money_in: number;
  money_out: number;
  merchant_collections: number;
  merchant_to_bank: number;
  bank_in: number;
  bank_to_cash: number;
};

export type ReceiptsAndPayments = {
  from: string;
  to: string;
  receipts: { category: string; total: number; entries: number }[];
  payments: { category: string; total: number; entries: number }[];
  reversals: { money_in: number; money_out: number; entries: number };
  transfers: { kind: TransferKind; entries: number; total: number }[];
};

/**
 * What `record_member_collection()` gives back: the account fields it owns,
 * merged over the payload of the member-side function that did the work - so a
 * savings collection still carries `period_label` and `period_total`, a share
 * sale its `quantity`, a repayment its `outstanding`, and a disbursement its
 * `loan_no`.
 */
export type MemberCollectionResult = {
  transaction_id: string;
  reference: string;
  receipt_no: string | null;
  account_id: string;
  account_name: string;
  account_type: FinanceAccountType;
  account_balance: number;
  method: PaymentMethod;
  member_id: string;
  member_name: string;
  member_no: string;
  collection_type: CollectionType;
  direction: 'in' | 'out';
  amount: number;
  duplicate: boolean;

  /* Savings */
  period_id?: string;
  period_label?: string;
  period_total?: number;
  paid?: number;
  status?: string;
  /* Shares */
  quantity?: number;
  unit_price?: number;
  total_value?: number;
  /* Loans */
  loan_id?: string;
  loan_no?: string;
  outstanding?: number;
  completed?: boolean;
  first_due_on?: string;
  installments?: number;
};

export type OtherReceiptResult = {
  transaction_id: string;
  reference: string;
  receipt_no: string | null;
  account_name: string;
  account_balance: number;
};

export type TransferResult = {
  id: string;
  transfer_no: string;
  kind: TransferKind;
  status: FinanceDocStatus;
  amount: number;
  requires_approval: boolean;
  transaction_id: string | null;
  source_account: string;
  destination_account: string;
  source_balance: number;
  destination_balance: number;
  duplicate?: boolean;
};

export type PaymentResult = {
  id: string;
  payment_no: string;
  status: FinanceDocStatus;
  amount: number;
  requires_approval: boolean;
  transaction_id: string | null;
  account: string;
  account_balance: number;
  duplicate?: boolean;
};

export type ReconciliationResult = {
  id: string;
  reconciliation_no: string;
  system_balance: number;
  actual_balance: number;
  variance: number;
  outcome: 'reconciled' | 'variance';
};

/* --------------------------------------------------------------------------
 * Schema fragments merged into `Database` in db.ts
 * ----------------------------------------------------------------------- */

type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type View<Row> = { Row: Row; Relationships: [] };

export type TreasuryTables = {
  financial_accounts: Table<FinancialAccountRow>;
  account_ledger_entries: Table<AccountLedgerEntryRow>;
  receipts: Table<ReceiptRow>;
  internal_transfers: Table<InternalTransferRow>;
  payment_categories: Table<PaymentCategoryRow>;
  payments: Table<PaymentRow>;
  reconciliations: Table<ReconciliationRow>;
  finance_documents: Table<FinanceDocumentRow>;
};

export type TreasuryViews = {
  financial_account_balances: View<FinancialAccountBalanceRow>;
  account_movements: View<AccountMovementRow>;
  receipt_register: View<ReceiptRegisterRow>;
  transfer_register: View<TransferRegisterRow>;
  payment_register: View<PaymentRegisterRow>;
  reconciliation_register: View<ReconciliationRegisterRow>;
};

export type TreasuryFunctions = {
  record_member_collection: {
    Args: {
      p_member_id: string;
      p_collection_type: CollectionType;
      p_amount: number;
      p_account_id: string;
      p_paid_on?: string;
      p_method?: PaymentMethod | null;
      p_external_ref?: string | null;
      p_description?: string | null;
      p_notes?: string | null;
      p_savings_kind?: SavingsKind | null;
      p_loan_id?: string | null;
      p_income_category_id?: string | null;
      p_idempotency_key?: string | null;
      p_period_id?: string | null;
      p_quantity?: number | null;
    };
    Returns: MemberCollectionResult;
  };
  record_other_receipt: {
    Args: {
      p_account_id: string;
      p_category_id: string;
      p_amount: number;
      p_received_on?: string;
      p_payer_name?: string | null;
      p_member_id?: string | null;
      p_method?: PaymentMethod | null;
      p_reference?: string | null;
      p_description?: string | null;
      p_idempotency_key?: string | null;
    };
    Returns: OtherReceiptResult;
  };
  create_internal_transfer: {
    Args: {
      p_source_account_id: string;
      p_destination_account_id: string;
      p_amount: number;
      p_transfer_date?: string;
      p_source_reference?: string | null;
      p_destination_reference?: string | null;
      p_description?: string | null;
      p_purpose?: string | null;
      p_handled_by?: string | null;
      p_notes?: string | null;
      p_submit?: boolean;
      p_idempotency_key?: string | null;
    };
    Returns: TransferResult;
  };
  submit_internal_transfer: { Args: { p_id: string }; Returns: TransferResult };
  decide_internal_transfer: {
    Args: { p_id: string; p_approve: boolean; p_reason?: string | null };
    Returns: TransferResult;
  };
  cancel_internal_transfer: { Args: { p_id: string; p_reason: string }; Returns: TransferResult };
  create_payment: {
    Args: {
      p_payee: string;
      p_category_id: string;
      p_amount: number;
      p_account_id: string;
      p_payment_date?: string;
      p_member_id?: string | null;
      p_method?: PaymentMethod | null;
      p_reference?: string | null;
      p_description?: string | null;
      p_notes?: string | null;
      p_submit?: boolean;
      p_idempotency_key?: string | null;
    };
    Returns: PaymentResult;
  };
  submit_payment: { Args: { p_id: string }; Returns: PaymentResult };
  decide_payment: {
    Args: { p_id: string; p_approve: boolean; p_reason?: string | null };
    Returns: PaymentResult;
  };
  cancel_payment: { Args: { p_id: string; p_reason: string }; Returns: PaymentResult };
  record_reconciliation: {
    Args: {
      p_account_id: string;
      p_reconciliation_date: string;
      p_actual_balance: number;
      p_reason?: string | null;
      p_statement_reference?: string | null;
      p_notes?: string | null;
    };
    Returns: ReconciliationResult;
  };
  create_financial_account: {
    Args: {
      p_account_type: FinanceAccountType;
      p_name: string;
      p_provider?: string | null;
      p_merchant_code?: string | null;
      p_account_identifier?: string | null;
      p_bank_name?: string | null;
      p_branch?: string | null;
      p_account_number?: string | null;
      p_opening_balance?: number;
      p_opening_date?: string | null;
      p_description?: string | null;
      p_is_default?: boolean;
    };
    Returns: { id: string; code: string; name: string; is_default: boolean };
  };
  update_financial_account: {
    Args: {
      p_id: string;
      p_name: string;
      p_provider?: string | null;
      p_merchant_code?: string | null;
      p_account_identifier?: string | null;
      p_bank_name?: string | null;
      p_branch?: string | null;
      p_account_number?: string | null;
      p_opening_balance?: number | null;
      p_opening_date?: string | null;
      p_description?: string | null;
      p_is_default?: boolean | null;
      p_reason?: string | null;
    };
    Returns: { id: string; code: string; name: string };
  };
  set_financial_account_status: {
    Args: { p_id: string; p_status: FinanceAccountStatus; p_reason: string };
    Returns: { id: string; status: FinanceAccountStatus };
  };
  save_finance_category: {
    Args: {
      p_kind: 'income' | 'expense' | 'payment';
      p_id: string | null;
      p_name: string;
      p_description?: string | null;
      p_is_active?: boolean;
    };
    Returns: { id: string; kind: string; name: string };
  };
  attach_finance_document: {
    Args: {
      p_owner_type: FinanceDocumentRow['owner_type'];
      p_owner_id: string;
      p_storage_path: string;
      p_file_name: string;
      p_mime_type?: string | null;
      p_size_bytes?: number | null;
    };
    Returns: { id: string; storage_path: string };
  };
  treasury_summary: { Args: { p_on?: string }; Returns: TreasurySummary };
  cash_bank_report: { Args: { p_from: string; p_to: string }; Returns: CashBankReport };
  treasury_monthly_flow: { Args: { p_months?: number }; Returns: MonthlyFlowPoint[] };
  receipts_and_payments: { Args: { p_from: string; p_to: string }; Returns: ReceiptsAndPayments };
  default_financial_account: { Args: { p_type: FinanceAccountType }; Returns: string | null };
  treasury_requires_approval: { Args: { p_amount: number }; Returns: boolean };
};
