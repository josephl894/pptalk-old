'use client';

/**
 * Thin React hook around `subscribeToProject` from lib/realtime.
 *
 * Why the effect dep is just `projectId`: the handlers object will almost
 * always be a fresh literal each render at the call site, but we *don't*
 * want to tear down and rebuild the channel on every render — that would
 * thrash the websocket and miss events while the channel is reconnecting.
 *
 * Trade-off: callers must supply handlers that read live state via refs or
 * via setState's functional updater, since the handlers captured on first
 * mount are the ones that'll fire forever (or until projectId changes).
 *
 * That trade-off is fine for this surface: every handler we use just calls
 * `setSlides((prev) => ...)` style updates, which closes over the *setter*,
 * not over stale state.
 */

import { useEffect } from 'react';

import {
  subscribeToProject,
  type ProjectRealtimeEvents,
} from '@/lib/realtime';

export function useProjectRealtime(
  projectId: string,
  handlers: ProjectRealtimeEvents,
): void {
  useEffect(() => {
    const unsub = subscribeToProject(projectId, handlers);
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
}
