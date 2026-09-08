/**
 * Role-based access control.
 *
 * The navigation is built from this table, so an unauthorised module is never
 * rendered as a link the user can click and bounce off. `requireAccess()` in
 * `auth.ts` re-checks the same table server-side, and Postgres RLS checks it a
 * third time - a user who hand-types a URL gets a redirect, and a user who
 * hand-crafts an API call gets nothing back.
 *
 * The database expresses the same rules as capability predicates
 * (`can_view_operations()`, `can_record_savings()`, `can_manage_groups()`,
 * `can_view_finance()`, `can_view_audit()` in `0011_rbac_and_rls.sql`). The two
 * are meant to agree; where they cannot, the database wins, because it is the
 * one an attacker cannot skip.
 */

export type Role =
  | 'super_admin'
  | 'manager'
  | 'loan_officer'
  | 'cashier'
  | 'accountant'
  | 'group_officer'
  | 'viewer'
  | 'member';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  manager: 'SACCO Manager',
  loan_officer: 'Loan Officer',
  cashier: 'Cashier / Teller',
  accountant: 'Accountant',
  group_officer: 'Group Officer',
  viewer: 'Viewer',
  member: 'Member',
};

/** One line each, for the Users screen and the permission matrix. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: 'Full access, including staff accounts and reversals.',
  manager: 'Management and reporting across every module.',
  loan_officer: 'Members, groups, savings, loans and collections.',
  cashier: 'Front-desk collections, deposits, shares and repayments.',
  accountant: 'Transactions, income, expenses and the financial reports.',
  group_officer: 'Assigned groups: member savings and collection days.',
  viewer: 'Read-only. Cannot record or change anything.',
  member: 'Their own savings, shares and loans.',
};

/** Every guardable capability in the system. */
export type Permission =
  | 'dashboard.staff'
  | 'members.view'
  | 'members.manage'
  | 'members.status'
  | 'groups.view'
  | 'groups.manage'
  | 'shares.view'
  | 'shares.sell'
  | 'savings.view'
  | 'savings.record'
  | 'savings.waive'
  | 'loans.view'
  | 'loans.apply'
  | 'loans.assess'
  | 'loans.approve'
  | 'loans.disburse'
  | 'loans.repay'
  | 'guarantors.manage'
  | 'transactions.view'
  | 'transactions.reverse'
  | 'cash.movement'
  | 'finance.view'
  | 'finance.record'
  | 'finance.approve'
  | 'reports.view'
  | 'reports.member'
  | 'users.manage'
  | 'audit.view'
  | 'settings.view'
  /** Change how the SACCO is configured, loan products included. */
  | 'settings.manage';

/** What every member of staff can see, whatever else their role allows. */
const STAFF_BASE: Permission[] = [
  'dashboard.staff',
  'members.view',
  'groups.view',
  'savings.view',
  'transactions.view',
  'reports.view',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: [
    'dashboard.staff', 'members.view', 'members.manage', 'members.status',
    'groups.view', 'groups.manage',
    'shares.view', 'shares.sell', 'savings.view', 'savings.record', 'savings.waive',
    'loans.view', 'loans.apply', 'loans.assess', 'loans.approve', 'loans.disburse', 'loans.repay',
    'guarantors.manage', 'transactions.view', 'transactions.reverse', 'cash.movement',
    'finance.view', 'finance.record', 'finance.approve',
    'reports.view', 'reports.member', 'users.manage', 'audit.view', 'settings.view',
    'settings.manage',
  ],
  manager: [
    ...STAFF_BASE, 'members.manage', 'members.status', 'groups.manage',
    'shares.view', 'shares.sell', 'savings.record', 'savings.waive',
    'loans.view', 'loans.assess', 'loans.approve', 'loans.disburse', 'loans.repay',
    'guarantors.manage', 'transactions.reverse', 'cash.movement',
    'finance.view', 'finance.record', 'finance.approve', 'reports.member', 'audit.view',
    // The manager configures the SACCO: organisation details, share price,
    // savings defaults and the loan products members may borrow under. Every
    // control still re-checks its own permission before it acts, and the
    // database re-checks it again in `can_manage_settings()`.
    'settings.view', 'settings.manage',
  ],
  loan_officer: [
    ...STAFF_BASE,
    'loans.view', 'loans.apply', 'loans.assess', 'loans.repay',
    'guarantors.manage', 'reports.member',
  ],
  cashier: [
    ...STAFF_BASE,
    'shares.view', 'shares.sell', 'savings.record',
    'loans.view', 'loans.repay', 'cash.movement', 'finance.record',
  ],
  // The books, not the counter: an accountant reports on money that moved and
  // records income and expenses, but does not collect from members.
  accountant: [
    ...STAFF_BASE, 'shares.view', 'loans.view',
    'finance.view', 'finance.record', 'reports.member', 'audit.view',
  ],
  // The field role: collection days, and nothing that changes the register.
  group_officer: [...STAFF_BASE, 'savings.record', 'reports.member'],
  viewer: [...STAFF_BASE, 'shares.view', 'loans.view'],
  member: ['loans.apply'],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAny(role: Role | null | undefined, ...permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export function isStaff(role: Role | null | undefined): boolean {
  return !!role && role !== 'member';
}

/** Roles a super admin may assign to a staff account. */
export const STAFF_ROLES: readonly Role[] = [
  'super_admin', 'manager', 'loan_officer', 'cashier',
  'accountant', 'group_officer', 'viewer',
];

// ---------------------------------------------------------------------------
// Navigation
//
// `icon` values are Material Symbols names, matching the icons Stitch used in
// the exported sidebar and bottom bar. Keeping the same names means the same
// glyphs render.
// ---------------------------------------------------------------------------
export type NavItem = {
  label: string;
  href: string;
  icon: string;
  permission?: Permission;
  /** Shown in the mobile bottom bar (max 5, per the Stitch design). */
  bottomBar?: boolean;
  /** Sub-sections, rendered indented under the parent when it is active. */
  children?: readonly NavItem[];
};

/** Staff sidebar - mirrors the order in `staff_dashboard_desktop/code.html`. */
export const STAFF_NAV: readonly NavItem[] = [
  { label: 'Dashboard',    href: '/staff',              icon: 'dashboard',               permission: 'dashboard.staff', bottomBar: true },
  { label: 'Members',      href: '/staff/members',      icon: 'group',                   permission: 'members.view',    bottomBar: true },
  { label: 'Groups',       href: '/staff/groups',       icon: 'groups',                  permission: 'groups.view',     bottomBar: true },
  {
    label: 'Savings',
    href: '/staff/savings',
    icon: 'account_balance_wallet',
    permission: 'savings.view',
    bottomBar: true,
    children: [
      { label: 'Today’s Collections', href: '/staff/savings/today',        icon: 'event_available', permission: 'savings.view' },
      { label: 'Schedules',           href: '/staff/savings/schedules',    icon: 'calendar_month',  permission: 'savings.view' },
      { label: 'Performance',         href: '/staff/savings',              icon: 'assessment',      permission: 'savings.view' },
    ],
  },
  { label: 'Shares',       href: '/staff/shares',       icon: 'pie_chart',               permission: 'shares.view' },
  // A `Loan Products` child belongs here, pointing at /staff/loans/products.
  // It is left out until that route exists: a rail entry that 404s is worse
  // than one that is missing.
  { label: 'Loans',        href: '/staff/loans',        icon: 'payments',                permission: 'loans.view',      bottomBar: true },
  { label: 'Transactions', href: '/staff/transactions', icon: 'receipt_long',            permission: 'transactions.view' },
  { label: 'Finance',      href: '/staff/finance',      icon: 'account_balance',         permission: 'finance.view' },
  { label: 'Reports',      href: '/staff/reports',      icon: 'assessment',              permission: 'reports.view' },
  { label: 'Users',        href: '/staff/users',        icon: 'manage_accounts',         permission: 'users.manage' },
  { label: 'Audit Log',    href: '/staff/audit',        icon: 'policy',                  permission: 'audit.view' },
  { label: 'Settings',     href: '/staff/settings',     icon: 'settings',                permission: 'settings.view' },
];

/** Member bottom bar - exactly the five tabs the Stitch mobile screens show. */
export const MEMBER_NAV: readonly NavItem[] = [
  { label: 'Home',         href: '/',             icon: 'home',                   bottomBar: true },
  { label: 'Savings',      href: '/savings',      icon: 'account_balance_wallet', bottomBar: true },
  { label: 'Loans',        href: '/loans',        icon: 'payments',               bottomBar: true },
  { label: 'Transactions', href: '/transactions', icon: 'history',                bottomBar: true },
  { label: 'More',         href: '/more',         icon: 'menu',                   bottomBar: true },
];

/** Everything behind the member "More" tab. */
export const MEMBER_MORE_NAV: readonly NavItem[] = [
  { label: 'My Shares',    href: '/shares',        icon: 'pie_chart' },
  { label: 'Statements',   href: '/statements',    icon: 'description' },
  { label: 'Reports',      href: '/reports',       icon: 'assessment' },
  { label: 'Guarantees',   href: '/guarantees',    icon: 'handshake' },
  { label: 'Notifications', href: '/notifications', icon: 'notifications_active' },
  { label: 'My Profile',   href: '/profile',       icon: 'person' },
];

export function visibleNav(role: Role | null | undefined, items: readonly NavItem[]): NavItem[] {
  return items
    .filter((i) => !i.permission || can(role, i.permission))
    .map((i) =>
      i.children ? { ...i, children: visibleNav(role, i.children) } : i,
    );
}

/** Where a user lands after login, based on their role. */
export function landingPath(role: Role | null | undefined): string {
  return isStaff(role) ? '/staff' : '/';
}
