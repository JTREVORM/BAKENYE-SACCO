import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/db';

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Used by trusted server flows, including account provisioning and verified
 * password-change completion. Every call site must authorize its operation;
 * self-service password flows obtain the account ID from native Auth getUser().
 *
 * Importing this from a Client Component is a build error, because the key is
 * not a NEXT_PUBLIC_ variable and would be undefined in the browser.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Admin operations are unavailable.',
    );
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
