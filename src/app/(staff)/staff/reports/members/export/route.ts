import { NextResponse, type NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toNumber } from '@/lib/money';
import { todayISO } from '@/lib/format';
import type { MemberFinancialsRow, MemberStatus } from '@/types/db';

/**
 * Member register, as CSV, for the whole roll.
 *
 * F-05: the register page built its CSV in the browser from the rows it had
 * already fetched, and it fetched at most 1,000. Past 1,000 members the
 * download silently omitted the rest, with nothing on the button to say so.
 *
 * A download is not something to hold in a page's memory, so this streams:
 * rows are read from the database a page at a time and pushed out as they
 * arrive, which keeps the response flat in memory however long the roll gets.
 *
 * The same `members.view` permission as the register page, checked here and
 * not merely on the page that links to it - a URL can be typed. The query runs
 * as the signed-in officer, so RLS applies exactly as it does everywhere else.
 */

/** Rows per database round trip. Large enough to be few, small enough to stream. */
const PAGE = 500;

/** A hard stop, so a runaway loop cannot stream for ever. Far above any real roll. */
const MAX_ROWS = 200_000;

const HEADER = [
  'Member No',
  'Name',
  'Phone',
  'National ID',
  'Joined',
  'Status',
  'Savings',
  'Shares',
  'Share value',
  'Loan balance',
];

/** Quote anything that could break the column structure; double embedded quotes. */
function cell(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function line(values: (string | number | null | undefined)[]): string {
  return `${values.map(cell).join(',')}\r\n`;
}

export async function GET(request: NextRequest) {
  await requirePermission('members.view');

  const statusParam = request.nextUrl.searchParams.get('status');
  const status = statusParam ? (statusParam as MemberStatus) : null;
  const supabase = await createClient();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Excel on Windows mangles accented names without the BOM, which is not
      // a theoretical problem for a Ugandan membership roll.
      controller.enqueue(encoder.encode('﻿'));
      controller.enqueue(encoder.encode(line(HEADER)));

      let from = 0;
      try {
        for (;;) {
          let query = supabase
            .from('member_financials')
            .select(
              'member_no, full_name, phone, national_id, joined_on, status, savings_balance, share_count, share_value, loan_balance',
            )
            .order('member_no')
            .range(from, from + PAGE - 1);
          if (status) query = query.eq('status', status);

          const { data, error } = await query;
          if (error) throw new Error(error.message);

          const rows = (data ?? []) as Pick<
            MemberFinancialsRow,
            | 'member_no'
            | 'full_name'
            | 'phone'
            | 'national_id'
            | 'joined_on'
            | 'status'
            | 'savings_balance'
            | 'share_count'
            | 'share_value'
            | 'loan_balance'
          >[];

          for (const r of rows) {
            controller.enqueue(
              encoder.encode(
                line([
                  r.member_no,
                  r.full_name,
                  r.phone,
                  r.national_id ?? '',
                  r.joined_on,
                  r.status,
                  toNumber(r.savings_balance),
                  r.share_count,
                  toNumber(r.share_value),
                  toNumber(r.loan_balance),
                ]),
              ),
            );
          }

          from += rows.length;
          if (rows.length < PAGE || from >= MAX_ROWS) break;
        }
        controller.close();
      } catch (error) {
        // The response has already started, so there is no status code left to
        // change. Say so inside the file instead of truncating it silently -
        // the one thing a register export must never do.
        controller.enqueue(
          encoder.encode(
            line([
              `EXPORT INCOMPLETE - this file stops after ${from} members. Please try again.`,
            ]),
          ),
        );
        controller.error(error);
      }
    },
  });

  const name = `bnd-member-register-${status ?? 'all'}-${todayISO()}.csv`;
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
