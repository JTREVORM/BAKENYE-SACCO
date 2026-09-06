import { createClient } from '@/lib/supabase/server';
import type { PickedMember } from '@/components/forms/MemberPicker';

/**
 * Load one member in the shape `MemberPicker` expects, so a form arriving with
 * `?member=<id>` opens with that member already selected rather than making the
 * cashier search for someone they just navigated from.
 */
export async function getPickedMember(memberId: string | undefined): Promise<PickedMember | null> {
  if (!memberId) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from('member_financials')
    .select('id, member_no, full_name, phone, photo_url, savings_balance, share_value')
    .eq('id', memberId)
    .maybeSingle();

  return (data as PickedMember) ?? null;
}
