/**
 * Types for roles and permissions, fees, registration and the member sign-in
 * check - the schema added in 0029 and 0030.
 *
 * Kept apart from `db.ts` in the same way `treasury.ts` is, and merged into
 * `Database` there.
 */
import type {
  MemberMembershipFee,
  MemberStatus,
  MembershipFeeDashboard,
  MembershipFeeRow,
  PaymentMethod,
} from './db';
import type { FinanceAccountType } from './treasury';

/* ------------------------------------------------------------------ roles */

export type RoleKind = 'staff' | 'member';

/** Where a role lands after signing in. */
export type RoleDashboard =
  | 'administration' | 'overview' | 'cashier' | 'loans' | 'finance' | 'collections' | 'portal';

export type RoleRow = {
  key: string;
  name: string;
  description: string | null;
  kind: RoleKind;
  is_system: boolean;
  status: 'active' | 'inactive';
  dashboard: RoleDashboard;
  sort_order: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PermissionRow = {
  key: string;
  module: string;
  label: string;
  description: string | null;
  scope: RoleKind;
  /** Held by every role of its scope; not switchable. */
  is_core: boolean;
  /** Only a Super Admin may grant or withdraw it. */
  is_sensitive: boolean;
  sort_order: number;
};

export type RolePermissionRow = {
  role_key: string;
  permission_key: string;
  granted_by: string | null;
  granted_at: string;
};

/** What `my_session()` returns: the signed-in person, their role and permissions. */
export type SessionPayload = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  is_active: boolean;
  role: string;
  role_name: string;
  role_kind: RoleKind;
  role_active: boolean;
  role_dashboard: RoleDashboard;
  /** Whether the account holder has chosen their own password yet. */
  password_set: boolean;
  /** On a temporary password: the account can do nothing until it is changed. */
  must_change_password: boolean;
  member: { id: string; member_no: string; status: MemberStatus } | null;
  permissions: string[];
};

/* ------------------------------------------------------------------- fees */

export type FeeType =
  | 'membership' | 'registration' | 'application' | 'passbook'
  | 'welfare' | 'subscription' | 'other';

export type FeeChargedWhen = 'registration' | 'annual' | 'on_request';

export type FeeRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  amount: number;
  currency: string;
  fee_type: FeeType;
  charged_when: FeeChargedWhen;
  is_mandatory: boolean;
  applies_to_new_members: boolean;
  applies_to_existing_members: boolean;
  status: 'active' | 'inactive';
  effective_from: string;
  income_category_id: string;
  sort_order: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Since 0045 a charge can be settled in instalments, so `partial` sits between
 * the two ends: money has been received against it and it is not yet settled.
 * It is derived by `recompute_member_fee()` from the posted payment lines,
 * never typed in.
 */
export type MemberFeeStatus = 'unpaid' | 'partial' | 'paid' | 'waived';

export type MemberFeeRow = {
  id: string;
  member_id: string;
  fee_id: string;
  fee_name: string;
  amount: number;
  currency: string;
  is_mandatory: boolean;
  charged_at_registration: boolean;
  charged_on: string;
  charge_reason: string | null;
  status: MemberFeeStatus;
  paid_transaction_id: string | null;
  paid_on: string | null;
  waived_by: string | null;
  waived_at: string | null;
  waived_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FeePaymentLineRow = {
  id: number;
  transaction_id: string;
  member_fee_id: string;
  fee_id: string;
  description: string;
  amount: number;
  created_at: string;
};

/** One fee a new member would be charged, from `registration_fee_schedule()`. */
export type RegistrationFee = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  amount: number;
  currency: string;
  fee_type: FeeType;
  is_mandatory: boolean;
};

export type FeePaymentResult = {
  transaction_id: string;
  reference: string;
  receipt_no: string | null;
  amount: number;
  method: PaymentMethod;
  external_ref: string | null;
  paid_on: string;
  account_name: string | null;
  lines: { description: string; amount: number }[];
  duplicate: boolean;
};

export type RegistrationResult = {
  member_id: string;
  member_no: string;
  full_name: string;
  phone: string;
  status: MemberStatus;
  has_login: boolean;
  total_due: number;
  amount_paid: number;
  charges: { id: string; name: string; amount: number; is_mandatory: boolean; status: MemberFeeStatus }[];
  payment: FeePaymentResult | null;
  duplicate: boolean;
};

/** An account money can be received into, from `collection_accounts()`. No balance. */
export type CollectionAccount = {
  id: string;
  code: string;
  name: string;
  account_type: FinanceAccountType;
  is_default: boolean;
  provider: string | null;
  merchant_code: string | null;
  bank_name: string | null;
  account_number: string | null;
};

/* --------------------------------------------------------- member history */

export type MemberProfileChangeRow = {
  id: number;
  member_id: string;
  field: string;
  field_label: string;
  old_value: string | null;
  new_value: string | null;
  reason: string;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: string;
};

export type LoginAttemptRow = {
  id: number;
  identifier: string;
  kind: 'sign_in' | 'setup';
  user_id: string | null;
  client: string | null;
  succeeded: boolean;
  reason: string | null;
  created_at: string;
};

/* ------------------------------------------------------------- sign-in */

/** `login_resolve()` - server only, via the service role. */
export type LoginResolution = {
  key: string;
  locked: boolean;
  retry_at?: string;
  candidates: { user_id: string; auth_email: string }[];
};

/** A temporary password, returned once to the officer who created or reset the account. */
export type TemporaryPassword = { password: string };

/** `account_login_status()` - what staff may see about a login. Never the password. */
export type AccountLoginStatus = {
  user_id: string;
  is_active: boolean;
  role: string;
  phone: string | null;
  email: string | null;
  password_set_at: string | null;
  must_change_password: boolean;
  last_login_at: string | null;
  recent_failures: number;
  paused_until: string | null;
};

export type SecurityOverview = {
  staff_accounts: number;
  member_logins: number;
  /** Active accounts still on a temporary password. */
  must_change: number;
  signins_24h: number;
  failures_24h: number;
  paused_now: number;
  members_without_login: number;
};

/* ------------------------------------------------------------ DB wiring */

type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type AccessTables = {
  roles: Table<RoleRow>;
  permissions: Table<PermissionRow>;
  role_permissions: Table<RolePermissionRow>;
  fees: Table<FeeRow>;
  member_fees: Table<MemberFeeRow>;
  fee_payment_lines: Table<FeePaymentLineRow>;
  member_profile_changes: Table<MemberProfileChangeRow>;
  login_attempts: Table<LoginAttemptRow>;
};

type FeePayload = {
  name: string;
  description?: string | null;
  amount: number;
  fee_type: FeeType;
  charged_when: FeeChargedWhen;
  is_mandatory: boolean;
  applies_to_new_members: boolean;
  applies_to_existing_members: boolean;
  effective_from?: string | null;
  income_category_id?: string | null;
  sort_order?: number | null;
};

export type AccessFunctions = {
  my_session: { Args: Record<PropertyKey, never>; Returns: SessionPayload | null };
  log_logout: { Args: Record<PropertyKey, never>; Returns: undefined };
  log_password_changed: { Args: Record<PropertyKey, never>; Returns: undefined };
  login_resolve: { Args: { p_identifier: string; p_client?: string | null }; Returns: LoginResolution };
  login_record: {
    Args: { p_identifier: string; p_client: string | null; p_user_id: string | null; p_succeeded: boolean; p_reason?: string | null };
    Returns: undefined;
  };
  issue_temporary_password: { Args: { p_user_id: string }; Returns: undefined };
  account_login_status: { Args: { p_user_id: string }; Returns: AccountLoginStatus | null };
  security_overview: { Args: Record<PropertyKey, never>; Returns: SecurityOverview };
  assert_login_phone_available: { Args: { p_phone: string; p_except_user: string | null }; Returns: string | null };
  set_user_phone: { Args: { p_user_id: string; p_phone: string | null; p_reason: string }; Returns: { user_id: string; phone: string | null } };
  set_role_dashboard: { Args: { p_role_key: string; p_dashboard: string; p_reason?: string | null }; Returns: { role: string; dashboard: string } };
  has_permission: { Args: { p_key: string }; Returns: boolean };

  assert_can_assign_role: { Args: { p_role: string }; Returns: undefined };
  log_staff_account_created: { Args: { p_user_id: string }; Returns: undefined };
  create_role: {
    Args: { p_name: string; p_description: string | null; p_permissions: string[]; p_reason?: string | null };
    Returns: { role: string; name: string; permissions: string[] };
  };
  update_role: {
    Args: { p_role_key: string; p_name: string; p_description: string | null; p_reason?: string | null };
    Returns: { role: string; name: string };
  };
  set_role_status: {
    Args: { p_role_key: string; p_status: 'active' | 'inactive'; p_reason: string };
    Returns: { role: string; status: string };
  };
  set_role_permissions: {
    Args: { p_role_key: string; p_permissions: string[]; p_reason: string };
    Returns: { role: string; permissions: string[]; granted: string[]; withdrawn: string[] };
  };

  create_fee: { Args: { p: FeePayload; p_reason?: string | null }; Returns: FeeRow };
  update_fee: { Args: { p_fee_id: string; p: FeePayload; p_reason?: string | null }; Returns: FeeRow };
  set_fee_status: {
    Args: { p_fee_id: string; p_status: 'active' | 'inactive'; p_reason: string };
    Returns: FeeRow;
  };
  registration_fee_schedule: { Args: { p_on?: string | null }; Returns: RegistrationFee[] };
  pay_member_fees: {
    Args: {
      p_member_id: string;
      p_charge_ids: string[];
      p_account_id: string;
      p_method?: PaymentMethod | null;
      p_paid_on?: string | null;
      p_reference?: string | null;
      p_amount_received?: number | null;
      p_idempotency_key?: string | null;
    };
    Returns: FeePaymentResult;
  };

  /* --- The Membership Fees module (0045) ---------------------------------
   * Reading needs `can_view_operations()`; collecting needs `fees.collect`.
   * Both are re-checked in the database, so the checks in the server actions
   * are a courtesy to the UI, not the thing that holds. */
  membership_fee_dashboard: {
    Args: Record<string, never>;
    Returns: MembershipFeeDashboard;
  };
  search_membership_fees: {
    Args: {
      p_query?: string | null;
      p_status?: string | null;
      p_limit?: number;
      p_offset?: number;
    };
    Returns: MembershipFeeRow[];
  };
  member_membership_fee_detail: {
    Args: { p_member_id: string };
    Returns: MemberMembershipFee;
  };
  registration_fee_amount: {
    Args: Record<string, never>;
    Returns: number;
  };
  collect_membership_fee: {
    Args: {
      p_member_id: string;
      p_amount: number;
      p_account_id: string;
      p_method?: PaymentMethod | null;
      p_paid_on?: string | null;
      p_reference?: string | null;
      p_note?: string | null;
      p_idempotency_key?: string | null;
    };
    Returns: FeePaymentResult;
  };
  charge_member_fee: {
    Args: { p_member_id: string; p_fee_id: string; p_reason: string };
    Returns: MemberFeeRow;
  };
  waive_member_fee: { Args: { p_charge_id: string; p_reason: string }; Returns: MemberFeeRow };

  register_member: {
    Args: {
      p_member: Record<string, string | null>;
      p_optional_fee_ids?: string[];
      p_payment?: Record<string, string | number | boolean | null> | null;
      p_expected_total?: number | null;
      p_registration_key?: string | null;
      p_allow_shared_phone?: boolean;
      p_override_reason?: string | null;
    };
    Returns: RegistrationResult;
  };
  log_member_login_created: { Args: { p_member_id: string }; Returns: undefined };
  update_member_profile: {
    Args: {
      p_member_id: string;
      p_changes: Record<string, string | null>;
      p_reason: string;
      p_allow_shared_phone?: boolean;
    };
    Returns: { member_id: string; changed: string[]; user_id: string | null; phone: string };
  };
  collection_accounts: { Args: Record<PropertyKey, never>; Returns: CollectionAccount[] };
  finance_account_balance_at: {
    Args: { p_account_id: string; p_on?: string | null };
    Returns: number;
  };
};
