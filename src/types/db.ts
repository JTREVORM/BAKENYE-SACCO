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

export type UserRole = 'super_admin' | 'manager' | 'loan_officer' | 'cashier' | 'member';
export type MemberStatus = 'active' | 'inactive' | 'suspended' | 'exited';
export type SavingsKind = 'weekly' | 'monthly';
export type SavingsStatus = 'paid' | 'partial' | 'pending' | 'missed';
export type LoanStatus =
  | 'applied' | 'under_review' | 'approved' | 'rejected'
  | 'disbursed' | 'active' | 'completed' | 'defaulted' | 'written_off';
export type GuarantorStatus = 'pending' | 'accepted' | 'declined' | 'released';
export type TxnType =
  | 'share_purchase' | 'weekly_savings' | 'monthly_savings' | 'loan_disbursement'
  | 'loan_repayment' | 'deposit' | 'withdrawal' | 'income' | 'expense' | 'fee' | 'penalty';
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
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
  idempotency_key: string | null;
  recorded_by: string | null;
  created_at: string;
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
  created_at: string;
  updated_at: string;
};

export type SavingsPaymentRow = {
  id: string;
  period_id: string;
  member_id: string;
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  transaction_id: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type SavingsPlanRow = {
  id: string;
  member_id: string;
  kind: SavingsKind;
  target_amount: number;
  active_from: string;
  active_to: string | null;
  created_at: string;
};

export type LoanProductRow = {
  id: string;
  name: string;
  code: string;
  interest_rate: number;
  interest_method: 'flat' | 'reducing';
  min_amount: number;
  max_amount: number;
  min_period_months: number;
  max_period_months: number;
  processing_fee_pct: number;
  min_guarantors: number;
  is_active: boolean;
  description: string | null;
  created_at: string;
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

export type CategoryRow = { id: string; name: string; is_system: boolean };

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

// --- Views -----------------------------------------------------------------

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
};

export type LoanQuote = {
  product_id: string;
  product_name: string;
  principal: number;
  interest_rate: number;
  interest_method: string;
  interest_amount: number;
  processing_fee: number;
  total_payable: number;
  period_months: number;
  installment_amount: number;
  net_disbursed: number;
  min_guarantors: number;
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
};

export type SavingsPerformanceRow = {
  member_id: string;
  member_no: string;
  full_name: string;
  periods: number;
  expected: number;
  paid: number;
  balance: number;
  paid_periods: number;
  missed_periods: number;
  compliance: number;
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
      share_settings: Table<{ id: boolean; unit_price: number; min_shares_on_join: number; updated_at: string }>;
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
    };
    Views: {
      member_financials: View<MemberFinancialsRow>;
      member_savings: View<{ member_id: string; weekly_total: number; monthly_total: number; deposits_total: number; withdrawals_total: number; savings_balance: number }>;
      member_shares: View<{ member_id: string; share_count: number; share_value: number; last_purchase_on: string | null }>;
      member_loans_summary: View<{ member_id: string; active_loans: number; pending_loans: number; loan_balance: number; overdue_amount: number; next_due_on: string | null; next_due_amount: number | null }>;
      loan_balances: View<LoanBalanceRow>;
      transaction_feed: View<TransactionFeedRow>;
    };
    /**
     * RPC signatures.
     *
     * Spelled out rather than left as an index signature, so a typo in an
     * argument name — `p_memberid` instead of `p_member_id` — is a compile
     * error rather than a runtime `null` that books a transaction against
     * nobody.
     */
    Functions: {
      buy_shares: {
        Args: {
          p_member_id: string;
          p_quantity: number;
          p_method?: PaymentMethod;
          p_purchased_on?: string;
          p_note?: string | null;
          p_idempotency_key?: string | null;
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
          period_label: string;
          expected: number;
          paid: number;
          balance: number;
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
        };
        Returns: { expense_id: string; approval: ApprovalStatus };
      };
      approve_expense: {
        Args: { p_expense_id: string; p_approve: boolean; p_reason?: string | null };
        Returns: { expense_id: string; approval: ApprovalStatus; reference: string | null };
      };
      reverse_transaction: {
        Args: { p_transaction_id: string; p_reason: string };
        Returns: { original_reference: string; reversal_reference: string; reversal_id: string };
      };
      create_member: {
        Args: {
          p_full_name: string;
          p_phone: string;
          p_national_id?: string | null;
          p_email?: string | null;
          p_address?: string | null;
          p_date_of_birth?: string | null;
          p_gender?: string | null;
          p_occupation?: string | null;
          p_next_of_kin_name?: string | null;
          p_next_of_kin_phone?: string | null;
          p_next_of_kin_relation?: string | null;
          p_photo_url?: string | null;
          p_user_id?: string | null;
        };
        Returns: { member_id: string; member_no: string };
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
      email_for_member_no: { Args: { p_member_no: string }; Returns: string | null };
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
        Args: { p_kind: SavingsKind; p_from: string; p_to: string };
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
      mark_notifications_read: { Args: { p_ids?: string[] | null }; Returns: number };
      run_daily_maintenance: {
        Args: Record<PropertyKey, never>;
        Returns: { periods_marked_missed: number; loans_defaulted: number };
      };
    };
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
    };
    CompositeTypes: Record<string, never>;
  };
};
