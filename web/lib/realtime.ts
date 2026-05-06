/**
 * Client-side Supabase Realtime wrapper.
 *
 * Subscribes to `postgres_changes` events on the three tables that drive the
 * editor (render_jobs, slides, projects), filtered to a single project.
 *
 * Use only from client components — this module instantiates a browser-side
 * Supabase client with the anon key. Do NOT import `next/headers` or
 * service-role keys here; that would leak to the bundle.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ProjectRealtimeEvents = {
  /** postgres_changes on render_jobs WHERE project_id=projectId */
  onJobChange?: (payload: unknown) => void;
  /** postgres_changes on slides WHERE project_id=projectId */
  onSlideChange?: (payload: unknown) => void;
  /** postgres_changes on projects WHERE id=projectId */
  onProjectChange?: (payload: unknown) => void;
};

/**
 * Subscribe to realtime postgres_changes scoped to one project.
 *
 * Returns a cleanup function that unsubscribes the channel and removes it from
 * the client. Caller is responsible for invoking cleanup on unmount.
 *
 * Env access uses literal property notation (`process.env.NEXT_PUBLIC_*`).
 * Next/webpack only inlines `NEXT_PUBLIC_*` values into the client bundle when
 * they appear as a literal property access at build time — bracket notation
 * (`process.env[name]`) is opaque to the static replacement and silently
 * resolves to `undefined` in the browser.
 */
export function subscribeToProject(
  projectId: string,
  handlers: ProjectRealtimeEvents,
): () => void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is missing — set it in web/.env.local (see .env.example).',
    );
  }
  if (!anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY is missing — set it in web/.env.local (see .env.example).',
    );
  }

  const client: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  const channel = client.channel(`project:${projectId}`);

  if (handlers.onJobChange) {
    channel.on(
      // The third-arg shape for postgres_changes isn't fully typed in
      // @supabase/supabase-js; cast to satisfy TS without losing runtime
      // correctness.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      {
        event: '*',
        schema: 'public',
        table: 'render_jobs',
        filter: `project_id=eq.${projectId}`,
      },
      (payload: unknown) => handlers.onJobChange!(payload),
    );
  }

  if (handlers.onSlideChange) {
    channel.on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      {
        event: '*',
        schema: 'public',
        table: 'slides',
        filter: `project_id=eq.${projectId}`,
      },
      (payload: unknown) => handlers.onSlideChange!(payload),
    );
  }

  if (handlers.onProjectChange) {
    channel.on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      {
        event: '*',
        schema: 'public',
        table: 'projects',
        filter: `id=eq.${projectId}`,
      },
      (payload: unknown) => handlers.onProjectChange!(payload),
    );
  }

  channel.subscribe();

  return () => {
    try {
      channel.unsubscribe();
    } catch {
      // best-effort cleanup
    }
    try {
      client.removeChannel(channel);
    } catch {
      // best-effort cleanup
    }
  };
}
