'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/db';

/**
 * Browser Supabase client. Only ever sees the anon key, so every query it
 * makes is subject to the RLS policies in `0004_rls.sql`.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
