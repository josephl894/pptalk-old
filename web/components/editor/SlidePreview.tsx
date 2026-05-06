'use client';

/**
 * Center pane — large preview of the currently selected slide.
 *
 * Hi-Fi: paper card with the slide image, paper-2 footer with mono index +
 * resolution + "Generated narration".
 *
 * The card fills the row it's given (`h-full w-full`), and the image
 * letterboxes inside via `object-contain`. We don't constrain the card's
 * aspect ratio — `aspectRatio` + only `max-*` constraints (no explicit
 * width/height) collapses the box to 0×0, which was the prior bug. Letting
 * the card span the row and letterboxing inside gives the slide the
 * dominant share of the editor.
 */

import * as React from 'react';

import type { EditorSlide } from './types';

export function SlidePreview({
  slide,
  aspectW,
  aspectH,
  generated,
}: {
  slide: EditorSlide | null;
  aspectW: number | null;
  aspectH: number | null;
  generated: boolean;
}) {
  if (!slide) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-[13px] text-[color:var(--ink-3)]">Select a slide to preview</p>
      </div>
    );
  }

  const w = aspectW ?? 1920;
  const h = aspectH ?? 1080;

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="pp-card flex h-full w-full flex-col overflow-hidden">
        <div className="relative flex-1 bg-[color:var(--paper-2)]">
          {slide.png_signed_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={slide.png_signed_url}
              alt={slide.title ?? `Slide ${slide.idx + 1}`}
              className="absolute inset-0 size-full object-contain"
            />
          ) : (
            <div className="size-full" />
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-[color:var(--hairline)] bg-[color:var(--paper-2)] px-3.5 py-2.5 text-[12px] text-[color:var(--ink-3)]">
          <div className="flex items-center gap-2">
            <span className="font-mono">Slide {String(slide.idx + 1).padStart(2, '0')}</span>
            <span aria-hidden>·</span>
            <span>
              {w} × {h}
            </span>
            <span aria-hidden>·</span>
            <span>{generated ? 'Generated narration' : 'Speaker notes'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
