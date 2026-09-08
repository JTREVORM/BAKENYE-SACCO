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

export type UserRole =
  | 'super_admin' | 'manager' | 'loan_officer' | 'cashier'
  | 'accountant' | 'group_officer' | 'viewer' | 'member';
export type MemberStatus = 'active' | 'inactive' | 'suspended' | 'exited';
export type SavingsKind = 'weekly' | 'monthly';
export type SavingsStatus = 'paid' | 'partial' | 'pending' | 'missed' | 'waived';

/** How often a group collects. Weekly and biweekly both settle on a weekday. */
export type SavingFrequency = 'weekly' | 'biweekly' | 'monthly';
export type GroupStatus = 'active' | 'inactive' | 'dissolved';
export type CycleStatus = 'open' | 'closed';

/**
 * The payment seam. Phase One writes 'manual' only — no gateway is called and
 * no provider confirmation is ever fabricated.
 */
export type PaymentProvider =
  | 'manual' | 'mtn_momo' | 'airtel_money' | 'flutterwave' | 'pesapal' | 'bank';
export type PaymentState = 'pending' | 'processing' | 'successful' | 'failed' | 'cancelled';

/** ISO weekday, 1 = Monday .. 7 = Sunday. */
export type SavingDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;
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
  group_id: string | null;
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
  external_ref: string | null;
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
  cycle_id: string | null;
  group_id: string | null;
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
  default_saving_frequency: SavingFrequency;
  default_weekly_target: number;
  default_monthly_target: number;
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

// --- Groups, cycles and the payment seam ------------------------------------

export type SaccoGroupRow = {
  id: string;
  group_code: string;
  name: string;
  location: string | null;
  saving_day: SavingDay;
  saving_frequency: SavingFrequency;
  weekly_target: number;
  monthly_target: number;
  leader_member_id: string | null;
  secretary_member_id: string | null;
  loan_officer_id: string | null;
  status: GroupStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SavingsCycleRow = {
  id: string;
  group_id: string;
  kind: SavingsKind;
  cycle_start: string;
  cycle_end: string;
  due_on: string;
  label: string;
  status: CycleStatus;
  opened_by: string | null;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  note: string | null;
};

export type PaymentIntentRow = {
  id: string;
  reference: string;
  member_id: string | null;
  group_id: string | null;
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
  group_id: string | null;
  group_name: string | null;
  group_code: string | null;
  group_saving_day: SavingDay | null;
  /** Savings still owed across every unsettled schedule. */
  savings_outstanding: number;
};

/** `group_overview` — the group register row and the group dashboard header. */
export type GroupOverviewRow = {
  id: string;
  group_code: string;
  name: string;
  location: string | null;
  saving_day: SavingDay;
  saving_frequency: SavingFrequency;
  weekly_target: number;
  monthly_target: number;
  status: GroupStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  leader_member_id: string | null;
  leader_name: string | null;
  leader_phone: string | null;
  secretary_member_id: string | null;
  secretary_name: string | null;
  secretary_phone: string | null;
  loan_officer_id: string | null;
  loan_officer_name: string | null;
  member_count: number;
  active_member_count: number;
  total_savings: number;
  total_shares: number;
  total_loan_balance: number;
  current_cycle_id: string | null;
  current_cycle_label: string | null;
  current_cycle_due_on: string | null;
  current_expected: number | null;
  current_collected: number | null;
  current_outstanding: number | null;
  current_collection_rate: number | null;
};

/** `group_cycle_summary` — what one collection day adds up to. */
export type GroupCycleSummaryRow = {
  cycle_id: string;
  group_id: string;
  group_name: string;
  group_code: string;
  location: string | null;
  saving_day: SavingDay;
  saving_frequency: SavingFrequency;
  kind: SavingsKind;
  cycle_start: string;
  cycle_end: string;
  due_on: string;
  label: string;
  status: CycleStatus;
  opened_at: string;
  closed_at: string | null;
  members_expected: number;
  expected_amount: number;
  collected_amount: number;
  outstanding_amount: number;
  paid_members: number;
  partial_members: number;
  pending_members: number;
  missed_members: number;
  waived_members: number;
  collection_rate: number;
};

/** `savings_schedules` — one member, one cycle: expected, paid, outstanding. */
export type SavingsScheduleRow = {
  schedule_id: string;
  member_id: string;
  member_no: string;
  member_name: string;
  member_phone: string;
  member_photo: string | null;
  member_status: MemberStatus;
  group_id: string | null;
  group_name: string | null;
  group_code: string | null;
  saving_day: SavingDay | null;
  cycle_id: string | null;
  cycle_label: string | null;
  cycle_status: CycleStatus | null;
  kind: SavingsKind;
  period_start: string;
  period_end: string;
  period_label: string;
  due_on: string;
  expected_amount: number;
  paid_amount: number;
  outstanding: number;
  status: SavingsStatus;
  created_at: string;
  updated_at: string;
  last_method: PaymentMethod | null;
  last_reference: string | null;
  last_paid_on: string | null;
  last_transaction_id: string | null;
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
  total_groups: number;
  groups_saving_today: number;
  savings_arrears: number;
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
  group_name: string | null;
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

/** `group_collection_sheet()` — the whole collection screen in one round trip. */
export type CollectionSheet = {
  group: GroupOverviewRow;
  cycle: GroupCycleSummaryRow | null;
  rows: SavingsScheduleRow[];
  cycles: { cycle_id: string; label: string; due_on: string; status: CycleStatus }[];
};

/** One row of `groups_saving_on()` — a group due to collect today. */
export type GroupSavingToday = {
  group_id: string;
  group_code: string;
  name: string;
  location: string | null;
  saving_day: SavingDay;
  saving_day_label: string;
  saving_frequency: SavingFrequency;
  weekly_target: number;
  monthly_target: number;
  active_members: number;
  cycle_id: string | null;
  cycle_label: string | null;
  due_on: string | null;
  cycle_status: CycleStatus | null;
  members_expected: number;
  expected_amount: number;
  collected_amount: number;
  outstanding_amount: number;
  paid_members: number;
  partial_members: number;
  pending_members: number;
  missed_members: number;
  collection_rate: number;
};

export type SavingsDashboard = {
  date: string;
  total_members: number;
  total_groups: number;
  grouped_members: number;
  total_savings: number;
  today_expected: number;
  today_collected: number;
  today_outstanding: number;
  members_paid: number;
  members_partial: number;
  members_pending: number;
  members_missed: number;
  collected_today: number;
  total_arrears: number;
  collection_rate: number;
  groups_today: GroupSavingToday[];
};

export type GroupReportRow = {
  member_id: string;
  member_no: string;
  full_name: string;
  phone: string;
  status: MemberStatus;
  schedules: number;
  expected: number;
  paid: number;
  outstanding: number;
  paid_count: number;
  partial_count: number;
  missed_count: number;
};

export type GroupReport = {
  group: GroupOverviewRow;
  from: string;
  to: string;
  rows: GroupReportRow[];
  totals: { expected: number; paid: number; outstanding: number; members: number };
  collection_rate: number;
  generated_at: string;
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
      sacco_groups: Table<SaccoGroupRow>;
      savings_cycles: Table<SavingsCycleRow>;
      payment_intents: Table<PaymentIntentRow>;
    };
    Views: {
      member_financials: View<MemberFinancialsRow>;
      member_savings: View<{ member_id: string; weekly_total: number; monthly_total: number; deposits_total: number; withdrawals_total: number; savings_balance: number }>;
      member_shares: View<{ member_id: string; share_count: number; share_value: number; last_purchase_on: string | null }>;
      member_loans_summary: View<{ member_id: string; active_loans: number; pending_loans: number; loan_balance: number; overdue_amount: number; next_due_on: string | null; next_due_amount: number | null }>;
      loan_balances: View<LoanBalanceRow>;
      transaction_feed: View<TransactionFeedRow>;
      group_overview: View<GroupOverviewRow>;
      group_cycle_summary: View<GroupCycleSummaryRow>;
      savings_schedules: View<SavingsScheduleRow>;
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
          p_group_id?: string | null;
          p_unassigned?: boolean;
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
        Args: {
          p_kind: SavingsKind;
          p_from: string;
          p_to: string;
          p_group_id?: string | null;
          p_status?: SavingsStatus | null;
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
      /* --- Groups and group savings ------------------------------------- */
      create_group: {
        Args: {
          p_name: string;
          p_saving_day: SavingDay;
          p_saving_frequency?: SavingFrequency;
          p_location?: string | null;
          p_weekly_target?: number;
          p_monthly_target?: number;
          p_leader_member_id?: string | null;
          p_secretary_member_id?: string | null;
          p_loan_officer_id?: string | null;
          p_notes?: string | null;
        };
        Returns: { group_id: string; group_code: string; name: string };
      };
      update_group: {
        Args: {
          p_group_id: string;
          p_name: string;
          p_saving_day: SavingDay;
          p_saving_frequency: SavingFrequency;
          p_location?: string | null;
          p_weekly_target?: number;
          p_monthly_target?: number;
          p_leader_member_id?: string | null;
          p_secretary_member_id?: string | null;
          p_loan_officer_id?: string | null;
          p_notes?: string | null;
        };
        Returns: { group_id: string; group_code: string; name: string };
      };
      set_group_status: {
        Args: { p_group_id: string; p_status: GroupStatus; p_reason: string };
        Returns: { group_id: string; status: GroupStatus };
      };
      assign_member_group: {
        Args: { p_member_id: string; p_group_id: string | null; p_reason?: string | null };
        Returns: {
          member_id: string;
          group_id: string | null;
          group_name: string | null;
          schedules_moved: number;
        };
      };
      open_group_cycle: {
        Args: { p_group_id: string; p_on?: string };
        Returns: {
          cycle_id: string;
          group_id: string;
          group_name: string;
          kind: SavingsKind;
          label: string;
          due_on: string;
          members: number;
          created: boolean;
        };
      };
      open_cycles_for_day: {
        Args: { p_on?: string };
        Returns: { date: string; groups: number; schedules: number };
      };
      close_savings_cycle: {
        Args: { p_cycle_id: string; p_note?: string | null };
        Returns: { cycle_id: string; status: CycleStatus; marked_missed: number };
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
          member_name: string;
          period_label: string;
          expected: number;
          paid: number;
          outstanding: number;
          status: SavingsStatus;
        };
      };
      waive_savings_schedule: {
        Args: { p_schedule_id: string; p_reason: string };
        Returns: { schedule_id: string; status: SavingsStatus };
      };
      search_groups: {
        Args: {
          p_query?: string | null;
          p_status?: GroupStatus | null;
          p_saving_day?: SavingDay | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: { rows: GroupOverviewRow[]; total: number; limit: number; offset: number };
      };
      group_collection_sheet: {
        Args: { p_group_id: string; p_cycle_id?: string | null };
        Returns: CollectionSheet;
      };
      groups_saving_on: { Args: { p_on?: string }; Returns: GroupSavingToday[] };
      savings_dashboard: { Args: { p_on?: string }; Returns: SavingsDashboard };
      group_report: {
        Args: { p_group_id: string; p_from: string; p_to: string };
        Returns: GroupReport;
      };
      saving_day_label: { Args: { p_day: SavingDay }; Returns: string };

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
          p_default_saving_frequency: SavingFrequency;
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
          cycles_opened: { date: string; groups: number; schedules: number };
        };
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
      saving_frequency: SavingFrequency;
      group_status: GroupStatus;
      cycle_status: CycleStatus;
      payment_provider: PaymentProvider;
      payment_state: PaymentState;
    };
    CompositeTypes: Record<string, never>;
  };
};
