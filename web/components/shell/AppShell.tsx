'use client';

/**
 * App shell: persistent sidebar + main content area. Lives inside <CmdKProvider>
 * so the sidebar's "Samples" buttons can trigger the existing SampleModal via
 * `useCmdK().openSample(id)`.
 *
 * The Sidebar dispatches a `pp:open-sample` CustomEvent on click; this wrapper
 * subscribes and routes it through the cmd-K context. The detour keeps the
 * Sidebar a leaf component without forcing every consumer to plumb in a
 * callback prop.
 */

import * as React from 'react';

import { useCmdK } from '@/components/cmdk/CmdKProvider';
import { Sidebar, type SidebarSample } from './Sidebar';

export function AppShell({
  samples,
  children,
}: {
  samples: SidebarSample[];
  children: React.ReactNode;
}) {
  const { openSample } = useCmdK();
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    function onOpenSample(e: Event) {
      const detail = (e as CustomEvent<{ id?: string }>).detail;
      if (detail?.id) openSample(detail.id);
    }
    root.addEventListener('pp:open-sample', onOpenSample);
    return () => root.removeEventListener('pp:open-sample', onOpenSample);
  }, [openSample]);

  return (
    <div ref={rootRef} className="flex h-full min-h-screen">
      <Sidebar samples={samples} />
      <main className="flex min-w-0 flex-1 flex-col bg-[color:var(--paper)]">{children}</main>
    </div>
  );
}
