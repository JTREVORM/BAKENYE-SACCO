/**
 * Role-based access control.
 *
 * Roles and what they may do are data: rows in `roles`, `permissions` and
 * `role_permissions` (0029), edited on the Roles & Permissions screen by a
 * Super Admin. The signed-in person's permissions arrive with their session
 * (`my_session()`), and everything here asks that list.
 *
 * The same list is enforced three times: navigation hides what you cannot use,
 * `requirePermission()` in `auth.ts` guards the route, and `has_permission()`
 * in Postgres guards the data and every function that changes it. Where the
 * app and the database could ever disagree, the database wins, because it is
 * the one an attacker cannot skip.
 *
 * What stays in code is the permission *catalogue* - the keys below - because
 * a permission is only real if a function enforces it. A role can be invented
 * on a screen; a permission cannot.
 */

/** A role key, e.g. `super_admin`. Roles are rows, so this is open-ended. */
export type Role = string;

export type RoleKind = 'staff' | 'member';

/** Every permission the system can check. Mirrors the `permissions` table. */
export type Permission =
  | 'dashboard.staff'
  | 'members.view'
  | 'members.create'
  | 'members.manage'
  | 'members.status'
  | 'members.phone_override'
  | 'categories.view'
  | 'categories.manage'
  | 'fees.collect'
  | 'fees.manage'
  | 'shares.view'
  | 'shares.sell'
  | 'savings.view'
  | 'savings.record'
  | 'savings.waive'
  | 'loans.view'
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
  | 'finance.reconcile'
  | 'finance.accounts'
  | 'reports.view'
  | 'reports.member'
  | 'users.manage'
  | 'roles.manage'
  | 'audit.view'
  | 'settings.view'
  | 'settings.manage'
  | 'portal.view'
  | 'portal.loan_apply'
  | 'portal.guarantee_respond';

/**
 * Who is asking, as far as access is concerned: their role, whether that role
 * is staff or member, and the permissions it holds. `SessionUser` satisfies
 * this, and so does the small object a client component is handed.
 */
export type Access = {
  role: Role;
  roleKind: RoleKind;
  permissions: readonly string[];
};

export function can(who: Access | null | undefined, permission: Permission): boolean {
  if (!who) return false;
  return who.permissions.includes(permission);
}

export function canAny(who: Access | null | undefined, ...permissions: Permission[]): boolean {
  return permissions.some((p) => can(who, p));
}

export function isStaff(who: Access | null | undefined): boolean {
  return who?.roleKind === 'staff';
}

/**
 * Display names for the roles that ship with the system, used where a screen
 * shows a role key recorded in the past (an audit entry) without the roles
 * table to hand. Live screens read the name from `roles`.
 */
export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'SACCO Manager',
  loan_officer: 'Loan Officer',
  cashier: 'Cashier / Teller',
  accountant: 'Accountant',
  field_officer: 'Field Officer',
  viewer: 'Viewer',
  member: 'Member',
};

export function roleLabel(key: string | null | undefined): string {
  if (!key) return '—';
  return ROLE_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Navigation
//
// `icon` values are Material Symbols names, matching the icons Stitch used in
// the exported sidebar and bottom bar.
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
  {
    label: 'Members',
    href: '/staff/members',
    icon: 'group',
    permission: 'members.view',
    bottomBar: true,
    children: [
      { label: 'All Members',     href: '/staff/members',     icon: 'group',      permission: 'members.view' },
      { label: 'Register Member', href: '/staff/members/new', icon: 'person_add', permission: 'members.create' },
    ],
  },
  {
    label: 'Savings',
    href: '/staff/savings',
    icon: 'account_balance_wallet',
    permission: 'savings.view',
    bottomBar: true,
    children: [
      { label: 'Collect Savings', href: '/staff/savings/collect',   icon: 'point_of_sale',  permission: 'savings.view' },
      { label: 'Schedules',       href: '/staff/savings/schedules', icon: 'calendar_month', permission: 'savings.view' },
      { label: 'Performance',     href: '/staff/savings/performance', icon: 'assessment',   permission: 'savings.view' },
    ],
  },
  { label: 'Categories',   href: '/staff/categories',   icon: 'workspace_premium',       permission: 'categories.view', bottomBar: true },
  { label: 'Shares',       href: '/staff/shares',       icon: 'pie_chart',               permission: 'shares.view' },
  {
    label: 'Loans',
    href: '/staff/loans',
    icon: 'payments',
    permission: 'loans.view',
    bottomBar: true,
    children: [
      { label: 'All Loans',     href: '/staff/loans',          icon: 'payments',    permission: 'loans.view' },
      // Visible to anyone who may see loans, because a loan officer needs to
      // read a product's terms to explain them. Editing is guarded separately,
      // by `settings.manage`, on the screen itself.
      { label: 'Loan Products', href: '/staff/loans/products', icon: 'inventory_2', permission: 'loans.view' },
    ],
  },
  { label: 'Transactions', href: '/staff/transactions', icon: 'receipt_long',            permission: 'transactions.view' },
  {
    label: 'Finance',
    href: '/staff/finance',
    icon: 'account_balance',
    permission: 'finance.view',
    children: [
      { label: 'Overview',          href: '/staff/finance',                icon: 'dashboard',       permission: 'finance.view' },
      { label: 'Cash at Merchant',  href: '/staff/finance/merchant',       icon: 'smartphone',      permission: 'finance.view' },
      { label: 'Cash at Bank',      href: '/staff/finance/bank',           icon: 'account_balance', permission: 'finance.view' },
      { label: 'Cash at Hand',      href: '/staff/finance/cash',           icon: 'payments',        permission: 'finance.view' },
      { label: 'Receipts',          href: '/staff/finance/receipts',       icon: 'receipt_long',    permission: 'finance.view' },
      { label: 'Payments',          href: '/staff/finance/payments',       icon: 'request_quote',   permission: 'finance.view' },
      { label: 'Expenses',          href: '/staff/finance/expenses',       icon: 'trending_down',   permission: 'finance.view' },
      { label: 'Transfers',         href: '/staff/finance/transfers',      icon: 'swap_horiz',      permission: 'finance.view' },
      { label: 'Reconciliation',    href: '/staff/finance/reconciliation', icon: 'fact_check',      permission: 'finance.view' },
      { label: 'Ledger',            href: '/staff/finance/ledger',         icon: 'list_alt',        permission: 'finance.view' },
      { label: 'Reports',           href: '/staff/finance/reports',        icon: 'summarize',       permission: 'finance.view' },
      { label: 'Accounts & Setup',  href: '/staff/finance/accounts',       icon: 'tune',            permission: 'finance.view' },
    ],
  },
  { label: 'Reports',      href: '/staff/reports',      icon: 'assessment',              permission: 'reports.view' },
  { label: 'Users',        href: '/staff/users',        icon: 'manage_accounts',         permission: 'users.manage' },
  { label: 'Roles & Permissions', href: '/staff/roles', icon: 'shield_person',           permission: 'roles.manage' },
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

export function visibleNav(who: Access | null | undefined, items: readonly NavItem[]): NavItem[] {
  return items
    .filter((i) => !i.permission || can(who, i.permission))
    .map((i) => (i.children ? { ...i, children: visibleNav(who, i.children) } : i));
}

/** Where a user lands after login: the back office for staff, the portal for members. */
export function landingPath(who: Pick<Access, 'roleKind'> | null | undefined): string {
  return who?.roleKind === 'staff' ? '/staff' : '/';
}
