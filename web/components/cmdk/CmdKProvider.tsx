'use client';

/**
 * Top-level context that wires cmd+K and the sample-watch modal.
 *
 * State:
 *   - `paletteOpen` — whether the cmd+K palette is visible.
 *   - `activeSampleId` — which (if any) sample is open in <SampleModal>.
 *
 * "New project" is no longer a dialog (Wave 1 re-lock 2026-05-06) — it's a
 * dedicated `/new` route reached from the sidebar, the home grid's dashed
 * tile, and the cmd+K palette.
 */

import * as React from 'react';

import { CommandPalette } from './CommandPalette';
import { SampleModal } from '@/components/home/SampleModal';

export type CmdKSampleMeta = {
  id: string;
  name: string;
};

export type CmdKProjectMeta = {
  id: string;
  name: string;
};

type CmdKContextValue = {
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  openSample: (sampleId: string) => void;
};

const CmdKContext = React.createContext<CmdKContextValue | null>(null);

export function useCmdK(): CmdKContextValue {
  const ctx = React.useContext(CmdKContext);
  if (!ctx) {
    throw new Error('useCmdK must be used within <CmdKProvider>');
  }
  return ctx;
}

export function CmdKProvider({
  children,
  samples,
  projects,
}: {
  children: React.ReactNode;
  samples: CmdKSampleMeta[];
  projects: CmdKProjectMeta[];
}) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [activeSampleId, setActiveSampleId] = React.useState<string | null>(null);

  const value = React.useMemo<CmdKContextValue>(
    () => ({
      openPalette: () => setPaletteOpen(true),
      closePalette: () => setPaletteOpen(false),
      togglePalette: () => setPaletteOpen((v) => !v),
      openSample: (sampleId: string) => setActiveSampleId(sampleId),
    }),
    [],
  );

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <CmdKContext.Provider value={value}>
      {children}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        samples={samples}
        projects={projects}
      />
      <SampleModal
        sampleId={activeSampleId}
        onClose={() => setActiveSampleId(null)}
      />
    </CmdKContext.Provider>
  );
}
