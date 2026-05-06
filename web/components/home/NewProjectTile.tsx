/**
 * NewProjectTile — dashed "+ New project" first cell of the home grid.
 * Routes to /new (the dedicated full-page upload surface).
 */

import Link from 'next/link';

import { PlusIcon } from '@/components/shell/icons';

export function NewProjectTile() {
  return (
    <Link
      href="/new"
      className="flex flex-col cursor-pointer rounded-lg border border-dashed border-[color:var(--hairline-2)] bg-transparent transition-colors duration-150 ease-out hover:border-[color:var(--accent)] hover:bg-[color:var(--accent-tint)]/40"
    >
      <div className="pp-thumb flex flex-col items-center justify-center gap-2 border-dashed bg-transparent text-[color:var(--ink-3)]">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--accent-tint)] text-[color:var(--accent-2)]">
          <PlusIcon size={14} />
        </span>
        <div className="t-13 font-medium text-[color:var(--ink-2)]">New project</div>
        <div className="t-12 text-[color:var(--ink-4)]">Upload a deck</div>
      </div>
      <div className="invisible px-3.5 py-3">spacer</div>
    </Link>
  );
}
