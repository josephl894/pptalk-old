'use client';

/**
 * SampleCard — Hi-Fi card for read-only sample decks. Clicking opens the
 * existing SampleModal via the cmd-K provider's `openSample`.
 */

import { SlideThumb } from '@/components/shell/SlideThumb';
import { StatusTag, type ProjectStatus } from '@/components/shell/StatusTag';
import { useCmdK } from '@/components/cmdk/CmdKProvider';
import { formatRelativeTime } from './format';

export function SampleCard({
  id,
  name,
  status,
  numSlides,
  updatedAt,
}: {
  id: string;
  name: string;
  status: ProjectStatus;
  numSlides: number | null;
  updatedAt: string | Date;
}) {
  const { openSample } = useCmdK();
  return (
    <button
      type="button"
      onClick={() => openSample(id)}
      className="pp-card group flex flex-col text-left transition-shadow duration-150 ease-out hover:shadow-floater"
    >
      <div className="relative">
        <SlideThumb title={name} kind="body" accent />
        <div className="absolute left-2.5 top-2.5">
          <StatusTag status={status} />
        </div>
      </div>
      <div className="flex flex-col gap-1 px-3.5 py-3">
        <div className="t-14 truncate font-medium">{name}</div>
        <div className="flex items-center justify-between text-[12px] text-[color:var(--ink-3)]">
          <span>
            {numSlides != null ? `${numSlides} slides` : '—'} · {formatRelativeTime(updatedAt)}
          </span>
        </div>
      </div>
    </button>
  );
}
