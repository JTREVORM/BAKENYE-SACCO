import { Icon, Panel } from '@/components/ui/primitives';
import { ACCOUNT_TYPE_META, ACCOUNT_TYPES } from '@/lib/treasury-format';
import { formatAmount, formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { CashBankReport, FinanceAccountType, MovementClass } from '@/types/treasury';

type Movement = CashBankReport['movements'][number];
type Line = { label: string; amount: number; sign: '+' | '−' | '±' };

/**
 * One section of the Cash & Bank report: an account type's opening balance,
 * each kind of movement in and out, and its closing balance.
 *
 * The lines are sums of movements the database classified; nothing is
 * computed from anything else. Any movement the named lines do not cover
 * lands in "Other movements", so opening plus the lines always equals the
 * closing balance - and the section says so, because a cash report that does
 * not add up is worse than none.
 */
export function statementFor(report: CashBankReport, type: FinanceAccountType) {
  const accounts = report.accounts.filter((a) => a.account_type === type);
  const moves = report.movements.filter((m) => m.account_type === type);
  const used = new Set<Movement>();

  const sum = (pred: (m: Movement) => boolean, side: 'money_in' | 'money_out') =>
    moves
      .filter((m) => {
        if (!pred(m)) return false;
        used.add(m);
        return true;
      })
      .reduce((s, m) => s + toNumber(m[side]), 0);

  const is = (c: MovementClass, counter?: FinanceAccountType) => (m: Movement) =>
    m.movement_class === c && (counter === undefined || m.counter_account_type === counter);
  const spent = (m: Movement) => m.movement_class === 'payment' || m.movement_class === 'expense';

  const opening = accounts.reduce((s, a) => s + toNumber(a.opening), 0);
  const closing = accounts.reduce((s, a) => s + toNumber(a.closing), 0);

  let lines: Line[];
  if (type === 'merchant') {
    lines = [
      { label: 'Merchant collections', sign: '+', amount: sum(is('collection'), 'money_in') },
      { label: 'Other receipts', sign: '+', amount: sum(is('other_receipt'), 'money_in') },
      { label: 'Merchant → Bank transfers', sign: '−', amount: sum(is('transfer_out', 'bank'), 'money_out') },
      { label: 'Merchant payments', sign: '−', amount: sum(spent, 'money_out') },
    ];
  } else if (type === 'bank') {
    lines = [
      { label: 'Bank receipts', sign: '+', amount: sum((m) => is('collection')(m) || is('other_receipt')(m), 'money_in') },
      { label: 'Merchant → Bank transfers', sign: '+', amount: sum(is('transfer_in', 'merchant'), 'money_in') },
      { label: 'Cash → Bank deposits', sign: '+', amount: sum(is('transfer_in', 'cash'), 'money_in') },
      { label: 'Transfers from other bank accounts', sign: '+', amount: sum(is('transfer_in', 'bank'), 'money_in') },
      { label: 'Bank withdrawals (to cash)', sign: '−', amount: sum(is('transfer_out', 'cash'), 'money_out') },
      { label: 'Transfers to other bank accounts', sign: '−', amount: sum(is('transfer_out', 'bank'), 'money_out') },
      { label: 'Bank payments', sign: '−', amount: sum(spent, 'money_out') },
    ];
  } else {
    lines = [
      { label: 'Cash collections', sign: '+', amount: sum(is('collection'), 'money_in') },
      { label: 'Other cash receipts', sign: '+', amount: sum(is('other_receipt'), 'money_in') },
      { label: 'Bank withdrawals (from bank)', sign: '+', amount: sum(is('transfer_in', 'bank'), 'money_in') },
      { label: 'Cash → Bank deposits', sign: '−', amount: sum(is('transfer_out', 'bank'), 'money_out') },
      { label: 'Cash payments', sign: '−', amount: sum(spent, 'money_out') },
    ];
  }

  const reversals = moves
    .filter((m) => {
      if (m.movement_class !== 'reversal') return false;
      used.add(m);
      return true;
    })
    .reduce((s, m) => s + toNumber(m.money_in) - toNumber(m.money_out), 0);
  lines.push({ label: 'Reversals (net)', sign: '±', amount: reversals });

  const other = moves
    .filter((m) => !used.has(m))
    .reduce((s, m) => s + toNumber(m.money_in) - toNumber(m.money_out), 0);
  if (other !== 0) lines.push({ label: 'Other movements (net)', sign: '±', amount: other });

  const net = lines.reduce(
    (s, l) => s + (l.sign === '+' ? l.amount : l.sign === '−' ? -l.amount : l.amount),
    0,
  );

  return {
    accounts,
    opening,
    closing,
    lines,
    balanced: Math.abs(opening + net - closing) < 0.005,
  };
}

export function TypeStatement({ report, type }: { report: CashBankReport; type: FinanceAccountType }) {
  const meta = ACCOUNT_TYPE_META[type];
  const s = statementFor(report, type);

  return (
    <Panel
      title={meta.label}
      subtitle={s.accounts.length === 0 ? 'No account of this kind' : `${s.accounts.length} account${s.accounts.length === 1 ? '' : 's'}`}
      icon={meta.icon}
      padded={false}
      className="print-block"
    >
      <dl className="divide-y divide-outline-variant/70">
        <Row label="Opening balance" value={s.opening} strong />
        {s.lines.map((l) => (
          <Row key={l.label} label={l.label} value={l.amount} sign={l.sign} />
        ))}
        <Row label="Closing balance" value={s.closing} strong total />
      </dl>
      <p
        className={clsx(
          'flex items-center gap-1.5 border-t border-outline-variant/70 px-5 py-2.5 text-label-md font-normal',
          s.balanced ? 'text-on-surface-variant' : 'text-error',
        )}
      >
        <Icon name={s.balanced ? 'task_alt' : 'error'} size={15} />
        {s.balanced
          ? 'Opening + movements = closing, from the account ledger.'
          : 'These lines do not add up to the closing balance. Report this to the administrator.'}
      </p>
    </Panel>
  );
}

function Row({
  label,
  value,
  sign,
  strong,
  total,
}: {
  label: string;
  value: number;
  sign?: '+' | '−' | '±';
  strong?: boolean;
  total?: boolean;
}) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3 px-5 py-2.5', total && 'bg-surface-container-low')}>
      <dt className={clsx('text-body-md', strong ? 'font-semibold text-on-surface' : 'text-on-surface-variant')}>
        {sign ? <span className="tabular mr-2 inline-block w-3 text-center font-bold">{sign === '±' ? '±' : sign}</span> : null}
        {label}
      </dt>
      <dd
        className={clsx(
          'tabular shrink-0 text-body-md',
          strong ? 'font-bold text-on-surface' : value === 0 ? 'text-on-surface-variant' : 'font-semibold text-on-surface',
        )}
      >
        {sign === '±' && value > 0 ? '+' : ''}
        {formatUGX(value)}
      </dd>
    </div>
  );
}

/**
 * The consolidated cash position: every kind of account, opening, money in,
 * money out and closing - and the total.
 *
 * Per account type the in and out columns include internal transfers, because
 * for the bank a transfer in *is* money in. In the TOTAL row they are left
 * out: a transfer is both an in and an out of the same pot, and counting it
 * would inflate both columns by the same amount without changing the total.
 */
export function ConsolidatedPosition({ report }: { report: CashBankReport }) {
  const rows = ACCOUNT_TYPES.map((type) => {
    const accs = report.accounts.filter((a) => a.account_type === type);
    return {
      type,
      opening: accs.reduce((s, a) => s + toNumber(a.opening), 0),
      in: accs.reduce((s, a) => s + toNumber(a.money_in), 0),
      out: accs.reduce((s, a) => s + toNumber(a.money_out), 0),
      closing: accs.reduce((s, a) => s + toNumber(a.closing), 0),
    };
  });

  const transfers = report.movements.filter((m) => m.txn_type === 'transfer');
  const transferIn = transfers.reduce((s, m) => s + toNumber(m.money_in), 0);
  const transferOut = transfers.reduce((s, m) => s + toNumber(m.money_out), 0);

  const total = {
    opening: rows.reduce((s, r) => s + r.opening, 0),
    in: rows.reduce((s, r) => s + r.in, 0) - transferIn,
    out: rows.reduce((s, r) => s + r.out, 0) - transferOut,
    closing: rows.reduce((s, r) => s + r.closing, 0),
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-neu print-block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead className="border-b border-outline-variant bg-surface-container-low">
            <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-label-md [&>th]:font-semibold [&>th]:text-on-surface-variant">
              <th>Account</th>
              <th className="text-right">Opening</th>
              <th className="text-right">Money in</th>
              <th className="text-right">Money out</th>
              <th className="text-right">Closing</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-outline-variant/70 [&>tr>td]:px-4 [&>tr>td]:py-3 [&>tr>td]:text-body-md">
            {rows.map((r) => (
              <tr key={r.type}>
                <td className="font-semibold text-on-surface">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className={clsx('h-2.5 w-2.5 rounded-full', ACCOUNT_TYPE_META[r.type].stripe)} />
                    {ACCOUNT_TYPE_META[r.type].label}
                  </span>
                </td>
                <td className="tabular text-right">{formatAmount(r.opening)}</td>
                <td className="tabular text-right text-tertiary">{formatAmount(r.in)}</td>
                <td className="tabular text-right text-error">{formatAmount(r.out)}</td>
                <td className="tabular text-right font-semibold">{formatAmount(r.closing)}</td>
              </tr>
            ))}
            <tr className="bg-surface-container-low">
              <td className="font-bold uppercase tracking-wide text-on-surface">Total funds</td>
              <td className="tabular text-right font-bold">{formatAmount(total.opening)}</td>
              <td className="tabular text-right font-bold text-tertiary">{formatAmount(total.in)}</td>
              <td className="tabular text-right font-bold text-error">{formatAmount(total.out)}</td>
              <td className="tabular text-right font-bold">{formatAmount(total.closing)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-outline-variant/70 px-4 py-2.5 text-label-md font-normal text-on-surface-variant">
        Amounts in UGX. Internal transfers ({formatUGX(transferOut)} this period) move money between
        the SACCO&apos;s own accounts: they appear in each account&apos;s row and are left out of the
        total, where they net to zero.
      </p>
    </div>
  );
}
