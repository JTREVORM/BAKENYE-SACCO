import type { Metadata } from 'next';
import { requireStaff } from '@/lib/auth';
import { PageTitle, Avatar, Badge } from '@/components/ui/primitives';
import { ChangePasswordForm } from '@/app/(member)/profile/ChangePasswordForm';
import { SignOutButton } from '@/components/SignOutButton';
import { ROLE_LABELS, ROLE_PERMISSIONS } from '@/lib/rbac';
import { formatPhone } from '@/lib/format';

export const metadata: Metadata = { title: 'My Profile' };

export default async function StaffProfilePage() {
  const user = await requireStaff();
  const permissions = ROLE_PERMISSIONS[user.role];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageTitle title="My Profile" subtitle="Your account and access." />

      <section className="bg-surface shadow-card flex items-center gap-4 rounded-xl p-5">
        <Avatar name={user.fullName} src={user.photoUrl} size={64} />
        <div className="min-w-0">
          <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface truncate">
            {user.fullName}
          </h2>
          <p className="text-body-md font-body-md text-on-surface-variant truncate">
            {user.email ?? '—'}
          </p>
          {user.phone ? (
            <p className="text-body-md font-body-md text-on-surface-variant tabular truncate">
              {formatPhone(user.phone)}
            </p>
          ) : null}
          <div className="mt-2">
            <Badge tone="info">{ROLE_LABELS[user.role]}</Badge>
          </div>
        </div>
      </section>

      <section className="bg-surface shadow-card overflow-hidden rounded-xl">
        <div className="border-outline-variant bg-surface-container-low border-b px-4 py-3">
          <h2 className="text-button-text font-button-text text-on-surface">
            What you can do ({permissions.length})
          </h2>
        </div>
        <ul className="flex flex-wrap gap-2 p-4">
          {permissions.map((p) => (
            <li
              key={p}
              className="bg-surface-container text-on-surface-variant text-label-md font-label-md rounded-full px-3 py-1 normal-case"
            >
              {p.replace('.', ' · ')}
            </li>
          ))}
        </ul>
        <p className="text-label-md font-label-md text-on-surface-variant border-outline-variant border-t p-4 normal-case">
          Only a super admin can change your role. Ask them if you need different access.
        </p>
      </section>

      <section id="password">
        <ChangePasswordForm />
      </section>

      <SignOutButton label="Sign out" />
    </div>
  );
}
