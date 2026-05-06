/**
 * ProjectCard — Hi-Fi card for the home grid.
 * 16:9 SlideThumb + status pill overlay + meta footer. Clicking routes to
 * the editor at /p/[id] (samples are handled by SampleCard, not this).
 */

import Link from 'next/link';

import { SlideThumb } from '@/components/shell/SlideThumb';
import { StatusTag, type ProjectStatus } from '@/components/shell/StatusTag';
import { formatRelativeTime } from './format';

export function ProjectCard({
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
  return (
    <Link
      href={`/p/${id}`}
      className="pp-card group flex flex-col cursor-pointer transition-shadow duration-150 ease-out hover:shadow-floater"
    >
      <div className="relative">
        <SlideThumb title={name} kind="body" />
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
    </Link>
  );
}
