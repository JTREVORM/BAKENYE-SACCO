import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { getAccounts } from '@/lib/treasury';
import { Badge, PageTitle, Panel } from '@/components/ui/primitives';
import { Alert, EmptyState, ErrorState, PanelSkeleton } from '@/components/ui/states';
import { AccountFormButton, AccountStatusButton } from '@/components/finance/AccountAdmin';
import { CategoryManager } from '@/components/finance/CategoryManager';
import { ACCOUNT_TYPE_META, ACCOUNT_TYPES } from '@/lib/treasury-format';
import { formatDate } from '@/lib/format';
import { formatUGX } from '@/lib/money';

export const metadata: Metadata = { title: 'Accounts & Setup' };

/**
 * The merchant, bank and cash accounts, and the income, expense and payment
 * categories - everything about the finance module that the SACCO decides for
 * itself. Nothing here is hard-coded: a merchant code, a bank, an account
 * number and every category are rows a manager creates.
 */
export default async function AccountsPage() {
  const user = await requirePermission('finance.view');
  const manage = can(user, 'finance.accounts');

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="tune"
        title="Accounts & Setup"
        subtitle="Where the SACCO holds money, and the categories money is recorded under."
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: 'Accounts & Setup' }]}
        action={manage ? <AccountFormButton label="Set up an account" /> : undefined}
      />

      {!manage ? (
        <Alert tone="info" title="Read-only">
          Setting up accounts and categories needs the finance set-up permission, held by a Super Admin or the SACCO Manager.
        </Alert>
      ) : null}

      <Suspense fallback={<PanelSkeleton height="h-72" />}>
        <AccountGroups manage={manage} />
      </Suspense>

      <Suspense fallback={<PanelSkeleton height="h-72" />}>
        <Categories manage={manage} />
      </Suspense>

      <Panel title="Approval rules and alerts" icon="rule">
        <p className="text-body-md text-on-surface-variant">
          Who must approve transfers and payments, the four-eyes rule, whether an account may go below zero, and the thresholds the
          dashboard warns at are set under{' '}
          <Link href="/staff/settings?section=treasury" className="font-semibold text-primary underline">
            Settings → Cash &amp; Bank
          </Link>
          .
        </p>
      </Panel>
    </div>
  );
}

async function AccountGroups({ manage }: { manage: boolean }) {
  const accounts = await getAccounts();
  if (!accounts) return <ErrorState title="Unable to load the accounts" />;

  return (
    <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
      {ACCOUNT_TYPES.map((type) => {
        const meta = ACCOUNT_TYPE_META[type];
        const list = accounts.filter((a) => a.account_type === type);
        return (
          <Panel key={type} title={meta.label} subtitle={meta.subtitle} icon={meta.icon} padded={false}
            action={manage ? <AccountFormButton label="Add" defaultType={type} variant="outline" /> : undefined}>
            {list.length === 0 ? (
              <EmptyState compact icon={meta.icon} title={`No ${meta.noun} yet`}
                description={type === 'merchant'
                  ? 'Add the SACCO merchant account with its provider and merchant code before recording mobile money.'
                  : type === 'bank'
                    ? 'Add the SACCO bank account with its bank and account number before recording deposits.'
                    : 'Add the cash account the office till is recorded in.'} />
            ) : (
              <ul className="divide-y divide-outline-variant/70">
                {list.map((a) => (
                  <li key={a.id} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body-md font-semibold text-on-surface">{a.name}</span>
                      <span className="tabular text-label-md font-normal text-on-surface-variant">{a.code}</span>
                      {a.is_default ? <Badge tone="info">Default</Badge> : null}
                      <Badge tone={a.status === 'active' ? 'success' : a.status === 'inactive' ? 'warning' : 'neutral'}>{a.status}</Badge>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-label-md">
                      {type === 'merchant' ? (
                        <>
                          <Detail label="Provider" value={a.provider} />
                          <Detail label="Merchant code" value={a.merchant_code} />
                          <Detail label="Phone / identifier" value={a.account_identifier} />
                        </>
                      ) : null}
                      {type === 'bank' ? (
                        <>
                          <Detail label="Bank" value={a.bank_name} />
                          <Detail label="Account number" value={a.account_number} />
                          <Detail label="Branch" value={a.branch} />
                        </>
                      ) : null}
                      <Detail label="Currency" value={a.currency} />
                      <Detail label="Opening" value={`${formatUGX(a.opening_balance)} on ${formatDate(a.opening_date)}`} />
                      <Detail label="Balance" value={formatUGX(a.balance)} />
                      <Detail label="Entries" value={String(a.entry_count)} />
                    </dl>
                    {a.description ? <p className="text-label-md font-normal text-on-surface-variant">{a.description}</p> : null}
                    {manage ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <AccountFormButton account={a} label="Edit" variant="outline" />
                        <AccountStatusButton account={a} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="font-normal text-on-surface-variant">{label}</dt>
      <dd className="truncate font-semibold text-on-surface">{value || '—'}</dd>
    </div>
  );
}

async function Categories({ manage }: { manage: boolean }) {
  const supabase = await createClient();
  const [income, expense, payment] = await Promise.all([
    supabase.from('income_categories').select('id, name, description, is_active, is_system').order('name'),
    supabase.from('expense_categories').select('id, name, description, is_active, is_system').order('name'),
    supabase.from('payment_categories').select('id, name, description, is_active, is_system').order('name'),
  ]);
  if (income.error || expense.error || payment.error) return <ErrorState title="Unable to load the categories" />;

  return (
    <Panel id="categories" title="Categories" subtitle="Receipts, payments, income and expenses" icon="category">
      <CategoryManager
        canManage={manage}
        categories={{
          income: income.data ?? [],
          expense: expense.data ?? [],
          payment: payment.data ?? [],
        }}
      />
    </Panel>
  );
}
