/**
 * Role-based access control.
 *
 * The navigation is built from this table, so an unauthorised module is never
 * rendered as a link the user can click and bounce off. `requireAccess()` in
 * `auth.ts` re-checks the same table server-side, and Postgres RLS checks it a
 * third time - a user who hand-types a URL gets a redirect, and a user who
 * hand-crafts an API call gets nothing back.
 */

export type Role = 'super_admin' | 'manager' | 'loan_officer' | 'cashier' | 'member';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  manager: 'SACCO Manager',
  loan_officer: 'Loan Officer',
  cashier: 'Cashier / Teller',
  member: 'Member',
};

/** Every guardable capability in the system. */
export type Permission =
  | 'dashboard.staff'
  | 'members.view'
  | 'members.manage'
  | 'members.status'
  | 'shares.view'
  | 'shares.sell'
  | 'savings.view'
  | 'savings.record'
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
  | 'audit.view';

const STAFF_BASE: Permission[] = ['members.view', 'transactions.view', 'reports.view'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: [
    'dashboard.staff', 'members.view', 'members.manage', 'members.status',
    'shares.view', 'shares.sell', 'savings.view', 'savings.record',
    'loans.view', 'loans.apply', 'loans.assess', 'loans.approve', 'loans.disburse', 'loans.repay',
    'guarantors.manage', 'transactions.view', 'transactions.reverse', 'cash.movement',
    'finance.view', 'finance.record', 'finance.approve',
    'reports.view', 'reports.member', 'users.manage', 'audit.view',
  ],
  manager: [
    'dashboard.staff', ...STAFF_BASE, 'members.manage', 'members.status',
    'shares.view', 'shares.sell', 'savings.view', 'savings.record',
    'loans.view', 'loans.assess', 'loans.approve', 'loans.disburse', 'loans.repay',
    'guarantors.manage', 'transactions.reverse', 'cash.movement',
    'finance.view', 'finance.record', 'finance.approve', 'reports.member', 'audit.view',
  ],
  loan_officer: [
    'dashboard.staff', ...STAFF_BASE,
    'loans.view', 'loans.apply', 'loans.assess', 'loans.repay',
    'guarantors.manage', 'reports.member',
  ],
  cashier: [
    'dashboard.staff', ...STAFF_BASE,
    'shares.view', 'shares.sell', 'savings.view', 'savings.record',
    'loans.view', 'loans.repay', 'cash.movement', 'finance.record',
  ],
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
};

/** Staff sidebar - mirrors the order in `staff_dashboard_desktop/code.html`. */
export const STAFF_NAV: readonly NavItem[] = [
  { label: 'Dashboard',    href: '/staff',              icon: 'dashboard',               permission: 'dashboard.staff', bottomBar: true },
  { label: 'Members',      href: '/staff/members',      icon: 'group',                   permission: 'members.view',    bottomBar: true },
  { label: 'Shares',       href: '/staff/shares',       icon: 'pie_chart',               permission: 'shares.view' },
  { label: 'Savings',      href: '/staff/savings',      icon: 'account_balance_wallet',  permission: 'savings.view',    bottomBar: true },
  { label: 'Loans',        href: '/staff/loans',        icon: 'payments',                permission: 'loans.view',      bottomBar: true },
  { label: 'Transactions', href: '/staff/transactions', icon: 'receipt_long',            permission: 'transactions.view' },
  { label: 'Finance',      href: '/staff/finance',      icon: 'account_balance',         permission: 'finance.view' },
  { label: 'Reports',      href: '/staff/reports',      icon: 'assessment',              permission: 'reports.view' },
  { label: 'Users',        href: '/staff/users',        icon: 'manage_accounts',         permission: 'users.manage' },
  { label: 'Audit Log',    href: '/staff/audit',        icon: 'policy',                  permission: 'audit.view' },
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
  return items.filter((i) => !i.permission || can(role, i.permission));
}

/** Where a user lands after login, based on their role. */
export function landingPath(role: Role | null | undefined): string {
  return isStaff(role) ? '/staff' : '/';
}
