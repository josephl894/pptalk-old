/**
 * StatusTag — Hi-Fi pill with colored dot. Used over the home grid thumbnails
 * and (Wave 2) on the My-videos rows.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type ProjectStatus =
  | 'parsing'
  | 'ready'
  | 'rendering'
  | 'rendered'
  | 'failed';

const META: Record<
  ProjectStatus,
  { tagClass: string; dot: string; label: string }
> = {
  parsing: { tagClass: 'is-coral', dot: 'var(--accent)', label: 'Parsing' },
  rendering: { tagClass: 'is-coral', dot: 'var(--accent)', label: 'Rendering' },
  ready: { tagClass: '', dot: 'var(--ink-4)', label: 'Draft' },
  rendered: { tagClass: 'is-ok', dot: 'var(--ok)', label: 'Ready' },
  failed: { tagClass: 'is-bad', dot: 'var(--bad)', label: 'Failed' },
};

export function StatusTag({ status, className }: { status: ProjectStatus; className?: string }) {
  const m = META[status];
  return (
    <span className={cn('pp-tag', m.tagClass, className)}>
      <span className="pp-dot" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}
