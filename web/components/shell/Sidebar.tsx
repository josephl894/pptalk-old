'use client';

/**
 * Persistent left sidebar. Linear-modeled (224px wide). Houses the only
 * "+ New project" entry point (routes to `/new`). Active item is detected
 * from the current pathname.
 *
 * Wave 1 stubs `/videos`, `/voices`, `/trash` — they exist but render
 * placeholder pages.
 */

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import {
  HomeIcon,
  WorkIcon,
  VideosIcon,
  VoiceIcon,
  TrashIcon,
  PlusIcon,
  DiamondIcon,
} from './icons';

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  matches: (pathname: string) => boolean;
};

// Homepage and My work both route to `/` — for the demo we don't have a
// separate dashboard surface. "My work" is the canonical active entry on `/`
// since the page header reads "My work"; Homepage is a duplicate-entry that
// only highlights if we ever ship a different home surface (never matches `/`).
const NAV: NavItem[] = [
  { href: '/', label: 'Homepage', Icon: HomeIcon, matches: () => false },
  { href: '/', label: 'My work', Icon: WorkIcon, matches: (p) => p === '/' || p.startsWith('/p/') },
  { href: '/videos', label: 'My videos', Icon: VideosIcon, matches: (p) => p.startsWith('/videos') },
  { href: '/voices', label: 'Voice library', Icon: VoiceIcon, matches: (p) => p.startsWith('/voices') },
  { href: '/trash', label: 'Recycle bin', Icon: TrashIcon, matches: (p) => p.startsWith('/trash') },
];

export type SidebarSample = { id: string; name: string };

export function Sidebar({ samples }: { samples: SidebarSample[] }) {
  const pathname = usePathname() ?? '/';

  return (
    <aside className="pp-side">
      <div className="pp-side-brand">
        <div className="pp-side-logo">P</div>
        <div className="t-14 font-semibold">PPTalk</div>
        <span className="pp-tag is-outline ml-auto">demo</span>
      </div>

      <Link
        href="/new"
        className={cn(
          'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium',
          'bg-[color:var(--accent)] text-white shadow-[0_1px_2px_rgba(180,60,40,0.18),inset_0_1px_0_rgba(255,255,255,0.18)]',
          'transition-colors duration-150 ease-out hover:bg-[color:var(--accent-2)]',
          'mb-2.5',
        )}
      >
        <PlusIcon size={14} />
        New project
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, Icon, matches }) => {
          const active = matches(pathname);
          return (
            <Link
              key={label}
              href={href}
              className={cn('pp-side-item', active && 'is-active')}
            >
              <span className="pp-ico">
                <Icon size={16} />
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {samples.length > 0 && (
        <>
          <div className="pp-side-section">Samples</div>
          <nav className="flex flex-col gap-0.5">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                data-sample-id={s.id}
                className="pp-side-item w-full text-left"
                onClick={(e) => {
                  // Bubble up to the host page, which can wire this to the
                  // SampleModal via the cmd-K provider. Wave 1 hosts wire it.
                  const ev = new CustomEvent('pp:open-sample', { detail: { id: s.id }, bubbles: true });
                  e.currentTarget.dispatchEvent(ev);
                }}
              >
                <span className="pp-ico" style={{ color: 'var(--ink-4)' }}>
                  <DiamondIcon size={10} />
                </span>
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-[color:var(--hairline)] pt-3">
        <div className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--paper-3)] text-[11px] font-semibold text-[color:var(--ink-2)]">
          ?
        </div>
        <div className="flex flex-col leading-tight">
          <div className="t-12 font-medium">Anonymous</div>
          <div className="t-12 text-[color:var(--ink-4)]">cookie session</div>
        </div>
      </div>
    </aside>
  );
}
