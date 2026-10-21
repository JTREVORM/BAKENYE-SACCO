import { WelcomeHero } from '@/components/layout/Hero';
import type { Dashboard } from '@/lib/rbac';

/**
 * The top of every role dashboard: whose dashboard it is, named after the role
 * the person actually holds, and the way to the whole-SACCO overview.
 *
 * The banner itself is `WelcomeHero`, shared with the overview dashboard so
 * every role opens on the same shape. This wrapper is kept because the role
 * dashboards already call it by this name.
 */
export function DashboardHeader({
  roleName,
  fullName,
  subtitle,
  showOverviewLink = true,
}: {
  roleName: string;
  fullName: string;
  subtitle: string;
  showOverviewLink?: boolean;
}) {
  return (
    <WelcomeHero
      roleName={roleName}
      fullName={fullName}
      subtitle={subtitle}
      showOverviewLink={showOverviewLink}
    />
  );
}

/**
 * The same banner, for a page that is also a section of the workspace.
 *
 * Finance and Collections are two things at once: a section anyone with the
 * permission can open, and the dashboard a Treasurer or a Field Officer lands
 * on. This renders the role banner only for the role whose dashboard it is;
 * everyone else gets the page's ordinary section title, which is what they came
 * for. Returns `null` otherwise, so the caller can fall back in one line.
 */
export function RoleDashboardBanner({
  user,
  dashboard,
  subtitle,
}: {
  user: { dashboard?: Dashboard; roleName: string; fullName: string };
  dashboard: Dashboard;
  subtitle: string;
}) {
  if (user.dashboard !== dashboard) return null;
  return (
    <DashboardHeader
      roleName={user.roleName}
      fullName={user.fullName}
      subtitle={subtitle}
      showOverviewLink={dashboard !== 'overview'}
    />
  );
}
