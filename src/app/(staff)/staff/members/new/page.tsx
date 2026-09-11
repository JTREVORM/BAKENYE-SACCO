import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getSavingsCategories, getShareCategories } from '@/lib/queries';
import { getCollectionAccounts, getRegistrationFees } from '@/lib/access-queries';
import { getRules } from '@/lib/settings';
import { can } from '@/lib/rbac';
import { PageTitle } from '@/components/ui/primitives';
import { getBrand } from '@/lib/brand';
import { RegistrationWizard } from './RegistrationWizard';

export const metadata: Metadata = { title: 'Register a Member' };

export default async function NewMemberPage() {
  const user = await requirePermission('members.create');

  const [shareCategories, savingsCategories, fees, accounts, rules, brand] = await Promise.all([
    getShareCategories(),
    getSavingsCategories(),
    getRegistrationFees(),
    getCollectionAccounts(),
    getRules(),
    getBrand(),
  ]);

  return (
    <div>
      <PageTitle
        icon="person_add"
        title="Register a Member"
        subtitle={`Enrol a new member of ${brand.legalName}. Nothing is saved until the last step.`}
        breadcrumb={[{ label: 'Members', href: '/staff/members' }, { label: 'Register' }]}
      />
      <RegistrationWizard
        shareCategories={shareCategories}
        savingsCategories={savingsCategories}
        fees={fees}
        accounts={accounts}
        canOverridePhone={can(user, 'members.phone_override')}
        rules={{
          requireNationalId: rules.requireNationalId,
          requireDateOfBirth: rules.requireDateOfBirth,
          requireGender: rules.requireGender,
          requireNextOfKin: rules.requireNextOfKin,
          requireCategories: rules.registrationRequiresCategories,
          activationRequiresFees: rules.activationRequiresFees,
          minAge: rules.minAge,
        }}
      />
    </div>
  );
}
