'use client';

/**
 * Auto-save status chip. Three visual states:
 *   - idle:   nothing rendered (zero footprint in layout)
 *   - saving: small spinner + "Saving"
 *   - saved:  muted "Saved" — fades out automatically after 2s
 *
 * Failure case is surfaced via toast separately by the caller; this chip
 * just resets to `idle` after a brief moment if it sees `failed`.
 */

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export type AutoSaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function AutoSaveChip({
  state,
  className,
}: {
  state: AutoSaveState;
  className?: string;
}) {
  const [visibleState, setVisibleState] = React.useState<AutoSaveState>(state);

  React.useEffect(() => {
    setVisibleState(state);
    if (state === 'saved' || state === 'failed') {
      const t = setTimeout(() => setVisibleState('idle'), 2000);
      return () => clearTimeout(t);
    }
  }, [state]);

  if (visibleState === 'idle') return null;

  if (visibleState === 'saving') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-[12px] text-[color:var(--ink-3)] transition-opacity duration-150 ease-out',
          className,
        )}
        aria-live="polite"
      >
        <Loader2 className="size-3 animate-spin" />
        Saving
      </span>
    );
  }

  if (visibleState === 'saved') {
    return (
      <span
        className={cn('pp-tag is-ok', className)}
        aria-live="polite"
      >
        <span className="pp-dot" style={{ background: 'var(--ok)' }} />
        Saved
      </span>
    );
  }

  return (
    <span
      className={cn('pp-tag is-bad', className)}
      aria-live="polite"
    >
      <span className="pp-dot" style={{ background: 'var(--bad)' }} />
      Save failed
    </span>
  );
}
