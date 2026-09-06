import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/db';

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only two things are allowed to use it: creating auth users during member
 * onboarding and staff provisioning, and assigning roles. Every call site must
 * do its own permission check first - see `requirePermission()` in `auth.ts`.
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
