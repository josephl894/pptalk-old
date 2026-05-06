/**
 * SlideThumb — 16:9 placeholder thumbnail in the Hi-Fi paper-gradient style.
 * Used on the home grid card and (Wave 2) editor filmstrip / overview cards.
 *
 * `kind` controls the fake content layout. `accent` adds one coral bar so the
 * empty thumbs have a hint of brand without an actual image.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type SlideThumbKind = 'title' | 'body' | 'split';

export function SlideThumb({
  title,
  kind = 'body',
  accent = false,
  selected = false,
  dim = false,
  className,
}: {
  title: string;
  kind?: SlideThumbKind;
  accent?: boolean;
  selected?: boolean;
  dim?: boolean;
  className?: string;
}) {
  const style: React.CSSProperties = {
    borderColor: selected ? 'var(--accent)' : 'var(--hairline)',
    borderWidth: selected ? 1.5 : 1,
    boxShadow: selected ? '0 0 0 2px var(--accent-tint)' : undefined,
    opacity: dim ? 0.5 : 1,
  };

  return (
    <div className={cn('pp-thumb', className)} style={style}>
      <div className="pp-thumb-content">
        {kind === 'title' && (
          <>
            <div className="pp-thumb-title">{title}</div>
            <div className="pp-thumb-bar short" />
          </>
        )}
        {kind === 'body' && (
          <>
            <div className="pp-thumb-title">{title}</div>
            <div className="pp-thumb-bar long" />
            <div className="pp-thumb-bar med" />
            <div className="pp-thumb-bar long" />
            {accent && <div className="pp-thumb-bar coral" />}
            <div className="pp-thumb-bar short" />
          </>
        )}
        {kind === 'split' && (
          <>
            <div className="pp-thumb-title">{title}</div>
            <div className="flex flex-1 gap-1.5">
              <div className="flex flex-1 flex-col gap-1">
                <div className="pp-thumb-bar long" />
                <div className="pp-thumb-bar med" />
                <div className="pp-thumb-bar long" />
              </div>
              <div className="flex-1 rounded-[3px] bg-[color:var(--paper-3)]" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
