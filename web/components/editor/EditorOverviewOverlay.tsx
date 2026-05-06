'use client';

/**
 * Editor outline overlay — Surface 03 ("EditorOverview"), repackaged as a
 * dialog rather than a separate editor mode.
 *
 * Two jobs:
 *   1. Triage at a glance — row-wise list of all slides paired with their
 *      narration. Empty rows are obvious so the user knows what to draft.
 *   2. Bulk action — "Draft all narrations" enqueues a regen for every empty
 *      slide. Per-row "Draft this" sparkle for one-off regen on an empty row.
 *
 * Read-only: clicking a row closes the overlay and selects that slide in the
 * underlying editor for actual editing.
 */

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { SlideThumb } from '@/components/shell/SlideThumb';
import { CloseIcon, SparkleIcon } from '@/components/shell/icons';
import { voiceLabel } from './VoiceLibraryOverlay';
import type { EditorSlide } from './types';

export type EditorOverviewOverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  slides: EditorSlide[];
  voice: string;
  /** Called when user clicks a row — overlay closes and editor selects. */
  onSelectSlide: (slideId: string) => void;
};

function isEmptyScript(s: EditorSlide): boolean {
  return s.script == null || s.script.trim() === '';
}

export function EditorOverviewOverlay({
  open,
  onOpenChange,
  projectId,
  slides,
  voice,
  onSelectSlide,
}: EditorOverviewOverlayProps) {
  // Bulk-draft state. We snapshot the empty-set when the user clicks the
  // button so progress is computed against that frozen baseline (otherwise
  // realtime updates would shrink the denominator and the label would jump).
  const [bulkInFlight, setBulkInFlight] = React.useState(false);
  const [bulkBaselineIds, setBulkBaselineIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [showDraftedConfirm, setShowDraftedConfirm] = React.useState<{
    count: number;
  } | null>(null);

  // Per-row draft tracking — slides we've kicked off single-slide regens for
  // since the overlay was opened. Used purely for visual disabled state.
  const [perRowDrafting, setPerRowDrafting] = React.useState<Set<string>>(
    new Set(),
  );

  const emptySlideIds = React.useMemo(() => {
    return slides.filter(isEmptyScript).map((s) => s.id);
  }, [slides]);

  // While bulk is in flight, count how many baseline-empty slides have flipped
  // to non-empty (driven by realtime).
  const draftedSoFar = React.useMemo(() => {
    if (!bulkInFlight) return 0;
    let n = 0;
    for (const s of slides) {
      if (bulkBaselineIds.has(s.id) && !isEmptyScript(s)) n++;
    }
    return n;
  }, [bulkInFlight, bulkBaselineIds, slides]);

  // Detect bulk completion: when every baseline id is no longer empty.
  React.useEffect(() => {
    if (!bulkInFlight) return;
    if (bulkBaselineIds.size === 0) return;
    const remaining = [...bulkBaselineIds].filter((id) => {
      const slide = slides.find((s) => s.id === id);
      return slide ? isEmptyScript(slide) : false;
    });
    if (remaining.length === 0) {
      setBulkInFlight(false);
      setShowDraftedConfirm({ count: bulkBaselineIds.size });
      setBulkBaselineIds(new Set());
      const t = setTimeout(() => setShowDraftedConfirm(null), 3000);
      return () => clearTimeout(t);
    }
  }, [bulkInFlight, bulkBaselineIds, slides]);

  // Reset per-row drafting marks when their slide flips to non-empty.
  React.useEffect(() => {
    setPerRowDrafting((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let changed = false;
      for (const id of prev) {
        const slide = slides.find((s) => s.id === id);
        if (slide && !isEmptyScript(slide)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [slides]);

  async function handleDraftAll() {
    if (bulkInFlight) return;
    if (emptySlideIds.length === 0) return;
    const baseline = new Set(emptySlideIds);
    setBulkBaselineIds(baseline);
    setBulkInFlight(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/draft-all`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setBulkInFlight(false);
      setBulkBaselineIds(new Set());
      toast.error('Bulk draft failed', {
        description: e instanceof Error ? e.message : 'Try again.',
      });
    }
  }

  async function handleDraftOne(slideId: string) {
    if (perRowDrafting.has(slideId)) return;
    setPerRowDrafting((prev) => new Set(prev).add(slideId));
    try {
      const res = await fetch(`/api/slides/${slideId}/regen`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setPerRowDrafting((prev) => {
        const next = new Set(prev);
        next.delete(slideId);
        return next;
      });
      toast.error('Draft failed', {
        description: e instanceof Error ? e.message : 'Try again.',
      });
    }
  }

  function handleSelect(slideId: string) {
    onOpenChange(false);
    onSelectSlide(slideId);
  }

  // Reset transient bulk state when overlay closes so reopening starts fresh.
  React.useEffect(() => {
    if (!open) {
      setBulkInFlight(false);
      setBulkBaselineIds(new Set());
      setShowDraftedConfirm(null);
      setPerRowDrafting(new Set());
    }
  }, [open]);

  const totalEmpty = emptySlideIds.length;
  const draftAllDisabled = totalEmpty === 0 || bulkInFlight;
  const draftAllLabel = bulkInFlight
    ? `Drafting ${draftedSoFar} of ${bulkBaselineIds.size}…`
    : showDraftedConfirm
    ? `Drafted ${showDraftedConfirm.count} narration${showDraftedConfirm.count === 1 ? '' : 's'}`
    : 'Draft all narrations';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[1080px] gap-0 overflow-hidden p-0 sm:rounded-md">
        <DialogTitle className="sr-only">Outline</DialogTitle>
        <DialogDescription className="sr-only">
          Every slide and its narration in one row-wise list.
        </DialogDescription>

        <div className="flex h-[78vh] max-h-[760px] flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[color:var(--hairline)] px-5 py-3.5">
            <div className="flex flex-col leading-tight">
              <span className="t-16 font-semibold">Outline</span>
              <span className="t-12 text-[color:var(--ink-3)]">
                {slides.length} slide{slides.length === 1 ? '' : 's'}
                {totalEmpty > 0 && ` · ${totalEmpty} empty`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDraftAll}
                disabled={draftAllDisabled}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-150 ease-out',
                  'bg-[color:var(--accent)] text-white shadow-[0_1px_2px_rgba(180,60,40,0.18),inset_0_1px_0_rgba(255,255,255,0.18)]',
                  'hover:bg-[color:var(--accent-2)] disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <SparkleIcon size={12} />
                {draftAllLabel}
              </button>
              <button
                type="button"
                aria-label="Close"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--ink-3)] hover:bg-[color:var(--paper-2)] hover:text-[color:var(--ink)]"
              >
                <CloseIcon size={14} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 overflow-y-auto bg-[color:var(--paper-2)]">
            <div className="mx-auto flex w-full max-w-[820px] flex-col gap-3 px-6 py-6">
              {slides.length === 0 ? (
                <div className="flex flex-1 items-center justify-center py-16">
                  <p className="t-13 text-[color:var(--ink-3)]">No slides yet.</p>
                </div>
              ) : (
                slides.map((slide, i) => {
                  const empty = isEmptyScript(slide);
                  const drafting = perRowDrafting.has(slide.id) || (bulkInFlight && bulkBaselineIds.has(slide.id));
                  return (
                    <button
                      key={slide.id}
                      type="button"
                      onClick={() => handleSelect(slide.id)}
                      className="pp-card flex w-full items-start gap-4 p-4 text-left transition-shadow duration-150 ease-out hover:shadow-floater"
                    >
                      <div className="w-[160px] shrink-0">
                        {slide.png_signed_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={slide.png_signed_url}
                            alt=""
                            className="aspect-video w-full rounded-md border border-[color:var(--hairline)] object-cover"
                          />
                        ) : (
                          <SlideThumb title={slide.title ?? `Slide ${i + 1}`} kind="body" />
                        )}
                        <div className="mt-2 flex items-center justify-between text-[12px] text-[color:var(--ink-3)]">
                          <span className="font-mono">
                            Slide {String(i + 1).padStart(2, '0')}
                          </span>
                          {empty && <span className="pp-tag is-outline">Empty</span>}
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        {empty ? (
                          <div className="flex flex-col gap-2">
                            <p className="t-13 italic text-[color:var(--ink-3)]">
                              {drafting ? 'Drafting…' : 'No script yet.'}
                            </p>
                            {!drafting && (
                              <span
                                role="button"
                                tabIndex={-1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDraftOne(slide.id);
                                }}
                                className="inline-flex h-7 w-fit items-center gap-1 rounded-md px-2 text-[12px] font-medium text-[color:var(--ink-2)] hover:bg-[color:var(--paper-2)] hover:text-[color:var(--ink)]"
                              >
                                <Sparkles className="size-3" />
                                Draft this
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="script text-[color:var(--ink-1)]">
                            {slide.script}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-[12px] text-[color:var(--ink-3)]">
                          <span>{voiceLabel(voice)}</span>
                          {slide.script_locked && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="pp-tag is-coral">Locked</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
