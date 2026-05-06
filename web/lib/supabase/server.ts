/**
 * Server-side Supabase client factories.
 *
 * Two clients per `@supabase/ssr` conventions:
 *
 * - `createServerClient()` — anon-key client wired to Next.js cookies. Use from
 *   server components, server actions, and route handlers when you want the
 *   user-perspective (RLS applies as the anon role).
 * - `createServiceClient()` — service-role key, no cookie wiring. Use for
 *   privileged operations: storage uploads/signing on behalf of the user,
 *   anonymous-user upserts, anything that must bypass RLS.
 *
 * Env access is lazy (read at call time, not at module load) so `npm run build`
 * does not require Supabase env vars to be present.
 *
 * Server-only: `createServerClient()` imports `next/headers`, which fails on
 * the client. Do not import this module from client components.
 */

import { cookies } from 'next/headers';
import { createServerClient as createSsrServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in .env.local (see web/.env.example).`,
    );
  }
  return value;
}

/**
 * Anon-key Supabase client wired to Next.js request cookies.
 *
 * Use in server components / route handlers / server actions when you want the
 * user's perspective (RLS evaluated as `anon`). Each request must construct a
 * fresh client — never share across requests.
 *
 * Note: cookie writes from server components are advisory in Next 15 — Next
 * will silently drop them when the response has already been streamed. That's
 * fine for our anon-cookie usage: the only cookie we set is `pptalk_uid`, and
 * we set it from a route handler / middleware, not from server components.
 */
export async function createServerClient(): Promise<SupabaseClient> {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const cookieStore = await cookies();

  return createSsrServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        // In server components Next will throw when we try to write — swallow
        // that case so callers don't have to wrap every call in try/catch. In
        // route handlers / server actions, the writes do go through.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // No-op: server-component context, cookies are read-only.
        }
      },
    },
  });
}

/**
 * Service-role Supabase client. Bypasses RLS. Never expose the resulting
 * client (or the key) to the browser.
 *
 * Caches a singleton per process — service-role clients are stateless and safe
 * to share across requests (unlike the per-request anon client).
 */
let _serviceClient: SupabaseClient | null = null;
export function createServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  _serviceClient = createSupabaseClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return _serviceClient;
}
