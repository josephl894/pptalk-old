'use client';

/**
 * Cmd+K command palette. Nav-only for now (per design hat lock).
 *
 * Sections: Actions / Samples / Projects. Fuzzy filter is provided by `cmdk`
 * via the underlying shadcn `Command` primitive — we don't write our own.
 *
 * Selecting a sample fires `openSample(id)` on the CmdK context which is
 * handled by the provider's <SampleModal>. Selecting a user project routes
 * to /p/[id]. New project closes the palette and opens the upload dialog.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Play, FileText } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useCmdK, type CmdKProjectMeta, type CmdKSampleMeta } from './CmdKProvider';

export function CommandPalette({
  open,
  onOpenChange,
  samples,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  samples: CmdKSampleMeta[];
  projects: CmdKProjectMeta[];
}) {
  const router = useRouter();
  const { openSample, closePalette } = useCmdK();

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to a project, open a sample, or start something new."
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem
            value="new project create upload deck"
            onSelect={() => {
              closePalette();
              router.push('/new');
            }}
          >
            <Plus />
            <span>New project</span>
          </CommandItem>
        </CommandGroup>

        {samples.length > 0 && (
          <CommandGroup heading="Samples">
            {samples.map((s) => (
              <CommandItem
                key={s.id}
                value={`sample ${s.name}`}
                onSelect={() => {
                  closePalette();
                  openSample(s.id);
                }}
              >
                <Play />
                <span>{s.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {projects.length > 0 && (
          <CommandGroup heading="Projects">
            {projects.map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.name}`}
                onSelect={() => {
                  closePalette();
                  router.push(`/p/${p.id}`);
                }}
              >
                <FileText />
                <span>{p.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
