import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { Icon, PageTitle, Badge } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { LoanProductForm } from '@/components/loans/LoanProductForm';
import type { LoanProductRow } from '@/types/db';

export const metadata: Metadata = { title: 'Loan Product' };

/**
 * Edit one loan product.
 *
 * Readable by anyone who may see loans, editable only with `settings.manage` —
 * a loan officer needs to know a product's terms to explain them, and must not
 * be able to change them.
 */
export default async function LoanProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission('loans.view');
  const canManage = can(user.role, 'settings.manage');

  const supabase = await createClient();
  const { data } = await supabase.from('loan_products').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const product = data as LoanProductRow;

  // How many loans reference this product, so the consequence of an edit is
  // visible on the page where the edit is made.
  const { count } = await supabase
    .from('loans')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', id);

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="inventory_2"
        title={product.name}
        subtitle={`${product.code}${product.category ? ` · ${product.category}` : ''}`}
        breadcrumb={[
          { label: 'Staff', href: '/staff' },
          { label: 'Loans', href: '/staff/loans' },
          { label: 'Products', href: '/staff/loans/products' },
          { label: product.name },
        ]}
        action={
          <span className="flex items-center gap-2">
            <Badge tone={product.is_active ? 'success' : 'neutral'} dot>
              {product.is_active ? 'Active' : 'Retired'}
            </Badge>
          </span>
        }
      />

      {(count ?? 0) > 0 ? (
        <Alert tone="info" title={`${count} loan${count === 1 ? '' : 's'} written under this product`}>
          Changing the terms below affects new applications only. Every loan already written
          carries the interest rate, fees, term, frequency and penalty it was agreed on — those
          were recorded on the loan itself and are never read from this product again.{' '}
          <Link href={`/staff/loans?product=${product.id}`} className="font-semibold text-primary underline">
            See those loans
          </Link>
          .
        </Alert>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label-md font-normal text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="schedule" size={14} />
          Last changed {formatDate(product.updated_at)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="event" size={14} />
          Created {formatDate(product.created_at)}
        </span>
      </p>

      <LoanProductForm product={product} canManage={canManage} />
    </div>
  );
}
