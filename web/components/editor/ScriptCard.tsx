'use client';

/**
 * Script card — sits in the center column below the slide preview.
 *
 * Owns the auto-save lifecycle and the inline textarea (JetBrains Mono via
 * `font-mono`, 1.65 line-height per the locked design system). Per-slide
 * "Regenerate" lives in the right pane's Slide-settings card; this card is
 * just the editable narration plus a quiet "Draft this slide" affordance
 * when the script is empty and not locked.
 */

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Textarea } from '@/components/ui/textarea';
import type { EditorSlide } from './types';
import type { AutoSaveState } from './AutoSaveChip';

export function ScriptCard({
  slide,
  onSaveStatus,
}: {
  slide: EditorSlide | null;
  onSaveStatus: (s: AutoSaveState) => void;
}) {
  const slideId = slide?.id ?? null;

  const [draft, setDraft] = React.useState<string>(slide?.script ?? '');
  const lastSavedRef = React.useRef<string>(slide?.script ?? '');
  const [drafting, setDrafting] = React.useState(false);

  React.useEffect(() => {
    setDraft(slide?.script ?? '');
    lastSavedRef.current = slide?.script ?? '';
  }, [slideId, slide?.script]);

  // Drop the drafting flag once the regen lands and the script is non-empty.
  React.useEffect(() => {
    if (!drafting) return;
    if (slide?.script && slide.script.trim() !== '') setDrafting(false);
  }, [drafting, slide?.script]);

  // If the user navigates to a different slide, drop drafting.
  React.useEffect(() => {
    setDrafting(false);
  }, [slideId]);

  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function scheduleSave(next: string) {
    if (!slideId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    onSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/slides/${slideId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ script: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        lastSavedRef.current = next;
        onSaveStatus('saved');
      } catch (e) {
        onSaveStatus('failed');
        toast.error('Save failed', {
          description: e instanceof Error ? e.message : 'Try again.',
        });
      }
    }, 500);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setDraft(value);
    scheduleSave(value);
  }

  async function handleDraftThis() {
    if (!slideId || drafting) return;
    setDrafting(true);
    try {
      const res = await fetch(`/api/slides/${slideId}/regen`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setDrafting(false);
      toast.error('Draft failed', {
        description: e instanceof Error ? e.message : 'Try again.',
      });
    }
  }

  const audioDuration = slide?.audio_duration_s ?? null;
  const isEmpty = !draft || draft.trim() === '';
  const showDraftHint = !!slide && isEmpty && !slide.script_locked;

  return (
    <section className="pp-card flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="pp-dot" style={{ background: 'var(--accent)' }} />
          <span className="t-13 font-semibold">Narration</span>
          {audioDuration != null && audioDuration > 0 && (
            <span className="pp-tag" style={{ marginLeft: 4 }}>
              {formatDuration(audioDuration)}
            </span>
          )}
        </div>
        {showDraftHint && (
          <button
            type="button"
            onClick={handleDraftThis}
            disabled={drafting}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-[color:var(--ink-3)] transition-colors duration-150 ease-out hover:bg-[color:var(--paper-2)] hover:text-[color:var(--ink)] disabled:opacity-60"
          >
            <Sparkles className="size-3" />
            {drafting ? 'Drafting' : 'Draft this slide'}
          </button>
        )}
      </div>

      {slide ? (
        <Textarea
          value={draft}
          onChange={handleChange}
          placeholder="Narration for this slide"
          className="min-h-[120px] flex-1 resize-none border-0 bg-transparent p-0 font-mono text-[13px] leading-[1.65] focus-visible:ring-0 focus-visible:ring-offset-0"
          spellCheck
        />
      ) : (
        <p className="t-13 text-[color:var(--ink-3)]">Select a slide to edit.</p>
      )}
    </section>
  );
}

function formatDuration(s: number): string {
  if (!s || s <= 0) return '—';
  const total = Math.round(s);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
