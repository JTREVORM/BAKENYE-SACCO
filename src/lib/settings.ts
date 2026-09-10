import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type {
  SettingCategory,
  SettingValue,
  SystemSettingRow,
} from '@/types/db';

/**
 * The configuration service.
 *
 * One place the application asks what the SACCO's rules currently are. Screens,
 * server actions and reports all read from here, so they cannot disagree about
 * what a registration fee is, and none of them carries its own copy of a number
 * that a manager is entitled to change.
 *
 * The database remains the authority: every one of these values is also read by
 * the SQL functions that actually enforce it (`setting_number()` and its
 * siblings). What this module provides is the *same* answer to the UI, so the
 * screen can say in advance what the database is about to insist on, rather
 * than letting a member discover it in a rejection.
 *
 * Everything is wrapped in React `cache`, so a page that quotes the joining fee
 * in a heading and again in a summary issues one query rather than two.
 */

/** The whole registry, keyed by setting key. */
export type SettingsMap = Record<string, SettingValue>;

export const getSettingsMap = cache(async (): Promise<SettingsMap> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('settings_map');
  if (error || !data) return {};
  return data as SettingsMap;
});

/** Every setting with its full description — what the settings screen renders. */
export const getSettingRows = cache(async (): Promise<SystemSettingRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('system_settings')
    .select('*')
    .order('category')
    .order('sort_order')
    .order('key');
  return (data ?? []) as SystemSettingRow[];
});

export const getSettingsByCategory = cache(
  async (): Promise<Map<SettingCategory, SystemSettingRow[]>> => {
    const rows = await getSettingRows();
    const grouped = new Map<SettingCategory, SystemSettingRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.category);
      if (list) list.push(row);
      else grouped.set(row.category, [row]);
    }
    return grouped;
  },
);

/* --------------------------------------------------------------------------
 * Typed readers
 *
 * A missing key returns the supplied fallback rather than throwing. The
 * database throws on a missing key, and rightly — it is enforcing a rule and
 * must not enforce a guess. A screen is only *describing* the rule, and a
 * settings row that failed to load should not be the reason a member cannot see
 * their own savings page.
 * ----------------------------------------------------------------------- */

export function settingNumber(map: SettingsMap, key: string, fallback = 0): number {
  const raw = map[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

export function settingBool(map: SettingsMap, key: string, fallback = false): boolean {
  const raw = map[key];
  return typeof raw === 'boolean' ? raw : fallback;
}

export function settingText(map: SettingsMap, key: string, fallback = ''): string {
  const raw = map[key];
  return typeof raw === 'string' ? raw : fallback;
}

export function settingList(map: SettingsMap, key: string, fallback: string[] = []): string[] {
  const raw = map[key];
  return Array.isArray(raw) ? raw.map(String) : fallback;
}

/* --------------------------------------------------------------------------
 * Named rules
 *
 * Callers ask `rules.registrationFee`, not `map['members.registration_fee']`.
 * A mistyped key in a template string is a silent zero on a fee; a mistyped
 * property here does not compile.
 * ----------------------------------------------------------------------- */

export type SaccoRules = ReturnType<typeof toRules>;

function toRules(map: SettingsMap) {
  return {
    /** Raw access, for the rare screen that needs a key the list below omits. */
    map,

    currency: settingText(map, 'financial.currency_code', 'UGX'),
    financialYearStartMonth: settingNumber(map, 'financial.financial_year_start_month', 1),
    minDeposit: settingNumber(map, 'financial.min_deposit'),
    minWithdrawal: settingNumber(map, 'financial.min_withdrawal'),
    /** Zero means no ceiling, consistently across every limit here. */
    maxWithdrawal: settingNumber(map, 'financial.max_withdrawal_per_transaction'),
    maxCashTransaction: settingNumber(map, 'financial.max_cash_transaction'),
    withdrawalFee: settingNumber(map, 'financial.withdrawal_fee'),

    registrationFee: settingNumber(map, 'members.registration_fee'),
    annualSubscription: settingNumber(map, 'members.annual_subscription'),
    passbookFee: settingNumber(map, 'members.passbook_fee'),
    minSavingsBalance: settingNumber(map, 'members.min_savings_balance'),
    minAge: settingNumber(map, 'members.min_age', 18),

    minWeeklySaving: settingNumber(map, 'savings.min_weekly_amount'),
    minMonthlySaving: settingNumber(map, 'savings.min_monthly_amount'),
    allowPartialSaving: settingBool(map, 'savings.allow_partial_payment', true),
    allowAdvanceSaving: settingBool(map, 'savings.allow_advance_payment', true),
    missedPeriodPenalty: settingNumber(map, 'savings.missed_period_penalty'),

    maxActiveLoans: settingNumber(map, 'loans.max_active_per_member', 1),
    maxSavingsMultiple: settingNumber(map, 'loans.max_savings_multiple'),
    minMembershipMonths: settingNumber(map, 'loans.min_membership_months'),
    defaultGracePeriodDays: settingNumber(map, 'loans.default_grace_period_days'),
    defaultLatePenaltyPct: settingNumber(map, 'loans.default_late_penalty_pct'),
    requireGuarantors: settingBool(map, 'loans.require_guarantors', true),
    guarantorCoverPct: settingNumber(map, 'loans.guarantor_cover_pct', 100),
    approvalRequiredAbove: settingNumber(map, 'loans.auto_approve_limit'),

    /**
     * Whether a member's savings category has to match their share category.
     * Off by default: the SACCO's own worked example is a Gold shareholder who
     * saves at the Diamond rate.
     */
    shareMatchesSavings: settingBool(map, 'categories.share_matches_savings'),
    requireSavingsCategory: settingBool(map, 'categories.require_savings_category'),

    collectionReminderDays: settingNumber(map, 'notifications.collection_reminder_days', 1),
    loanDueReminderDays: settingNumber(map, 'notifications.loan_due_reminder_days', 3),
    notifyOnLoanDecision: settingBool(map, 'notifications.notify_on_loan_decision', true),

    sessionTimeoutMinutes: settingNumber(map, 'security.session_timeout_minutes', 60),
    passwordMinLength: settingNumber(map, 'security.password_min_length', 8),
    requireReasonOnReversal: settingBool(map, 'security.require_reason_on_reversal', true),

    /** ISO weekdays the SACCO is open, 1 = Monday. */
    businessDays: settingList(map, 'system.business_days', ['1', '2', '3', '4', '5'])
      .map(Number)
      .filter((d) => d >= 1 && d <= 7),
    receiptFooter: settingText(map, 'system.receipt_footer'),
    receiptShowBalance: settingBool(map, 'system.receipt_show_balance', true),
    statementFooter: settingText(map, 'system.statement_footer'),
  };
}

/**
 * The SACCO's current operating rules, named.
 *
 * The one call almost every consumer wants:
 *
 *     const rules = await getRules();
 *     if (amount < rules.minDeposit) { … }
 */
export const getRules = cache(async (): Promise<SaccoRules> => toRules(await getSettingsMap()));

/* --------------------------------------------------------------------------
 * Presentation
 * ----------------------------------------------------------------------- */

export const SETTING_CATEGORIES: {
  id: SettingCategory;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    id: 'financial',
    label: 'Financial',
    icon: 'payments',
    description: 'Currency, the financial year, and the limits on money crossing the counter.',
  },
  {
    id: 'loans',
    label: 'Loans',
    icon: 'account_balance',
    description: 'The rules every loan product is granted under, whatever its own terms say.',
  },
  {
    id: 'members',
    label: 'Members',
    icon: 'group',
    description: 'What it costs to join, and what a member is expected to maintain.',
  },
  {
    id: 'savings',
    label: 'Savings',
    icon: 'account_balance_wallet',
    description: 'Minimum contributions and how part payments are treated.',
  },
  {
    id: 'categories',
    label: 'Categories',
    icon: 'workspace_premium',
    description:
      'Whether share and savings categories must agree, and whether every member needs one.',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'notifications',
    description: 'When members are reminded, and what they are told.',
  },
  {
    id: 'security',
    label: 'Security',
    icon: 'security',
    description: 'Session, password and reversal policy.',
  },
  {
    id: 'system',
    label: 'System',
    icon: 'tune',
    description: 'Business days, and the wording printed on receipts and statements.',
  },
];

/** A stored value rendered the way the audit log and the summaries render it. */
export function formatSettingValue(row: SystemSettingRow, value: SettingValue): string {
  switch (row.value_type) {
    case 'boolean':
      return value ? 'On' : 'Off';
    case 'money':
      return `UGX ${Number(value).toLocaleString('en-UG')}`;
    case 'percent':
      return `${Number(value)}%`;
    case 'integer':
    case 'number':
      return `${Number(value).toLocaleString('en-UG')}${row.unit ? ` ${row.unit}` : ''}`;
    case 'select':
      return row.options?.find((o) => o.value === String(value))?.label ?? String(value);
    case 'multiselect': {
      const chosen = Array.isArray(value) ? value.map(String) : [];
      if (chosen.length === 0) return 'None';
      return chosen
        .map((v) => row.options?.find((o) => o.value === v)?.label ?? v)
        .join(', ');
    }
    default:
      return String(value ?? '');
  }
}
