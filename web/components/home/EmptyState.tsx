/**
 * Empty-state for first-time visitors with no projects.
 *
 * Per the design hat, this is the **one** illustrated empty state on the home
 * — restrained, with a single warm-coral accent on the soundwave. CTA routes
 * to `/new` (the dedicated full-page upload surface) rather than opening a
 * dialog; sidebar's "+ New project" is the only new-project entry.
 */

import Link from 'next/link';

import { PlusIcon } from '@/components/shell/icons';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center pt-16 pb-8 text-center">
      <EmptyIllustration />
      <h2 className="mt-6 text-xl font-semibold tracking-tight text-foreground">
        Make your first narrated video.
      </h2>
      <p className="mt-2 max-w-sm text-sm text-[color:var(--ink-3)]">
        Upload a deck. Pick a voice. Get a polished video.
      </p>
      <div className="mt-6">
        <Link
          href="/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[color:var(--accent)] px-4 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(180,60,40,0.18),inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors duration-150 ease-out hover:bg-[color:var(--accent-2)]"
        >
          <PlusIcon size={14} />
          New project
        </Link>
      </div>
    </div>
  );
}

function EmptyIllustration() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden>
      <rect x="22" y="30" width="56" height="40" rx="4" className="fill-muted stroke-border" strokeWidth="1.5" />
      <rect x="30" y="38" width="56" height="40" rx="4" className="fill-card stroke-border" strokeWidth="1.5" />
      <rect x="38" y="46" width="56" height="40" rx="4" className="fill-background stroke-border" strokeWidth="1.5" />
      <rect x="44" y="54" width="28" height="2" rx="1" className="fill-muted-foreground/40" />
      <rect x="44" y="60" width="40" height="2" rx="1" className="fill-muted-foreground/30" />
      <rect x="44" y="66" width="20" height="2" rx="1" className="fill-muted-foreground/30" />
      <path
        d="M16 96 L24 96 L28 88 L32 104 L36 84 L40 100 L44 90 L52 96 L60 96"
        className="stroke-primary"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
