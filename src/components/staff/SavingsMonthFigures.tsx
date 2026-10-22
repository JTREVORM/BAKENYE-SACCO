import { Money } from '@/components/ui/primitives';
import type { SavingsDashboard } from '@/types/db';

/** Same authoritative figures on the live dashboard and synthetic QA route. */
export function SavingsMonthFigures({ dash }: {
  dash: Pick<SavingsDashboard, 'collected_savings' | 'deposit_count' | 'saving_members' | 'average_deposit'>;
}) {
  return (
    <dl data-savings-figures className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-x-6 gap-y-5">
      <PanelFigure label="Saved this month" value={<Money value={dash.collected_savings} />} />
      <PanelFigure label="Deposits" value={String(dash.deposit_count)} />
      <PanelFigure label="Members who saved" value={String(dash.saving_members)} />
      <PanelFigure label="Average deposit" value={<Money value={dash.average_deposit} />} />
    </dl>
  );
}

function PanelFigure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant">{label}</dt>
      <dd className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface tabular mt-1 [overflow-wrap:normal]">
        {value}
      </dd>
    </div>
  );
}
