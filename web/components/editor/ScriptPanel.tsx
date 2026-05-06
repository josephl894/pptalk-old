'use client';

/**
 * Right rail — 3 stacked cards per the Wave 2 spec:
 *   1. Voice card (avatar + friendly name + play sample stub) → opens overlay
 *   2. Slide settings card (sparkle Regenerate button + Locked|Auto pill)
 *   3. Render card (diamond + copy + coral Render CTA)
 *
 * Out-of-scope (Wave 2 lock): per-slide voice override, Pace/Pause/Emphasis,
 * pronunciation fixes, caption-per-slide. Editing the narration text lives
 * in <ScriptCard> in the center pane, NOT here.
 */

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { PlayIcon, DiamondIcon, SparkleIcon } from '@/components/shell/icons';
import { VoiceLibraryOverlay, voiceLabel } from './VoiceLibraryOverlay';
import type { EditorSlide } from './types';

const REGEN_TIMEOUT_MS = 30_000;

export function ScriptPanel({
  slide,
  voice,
  onVoiceChange,
  onOpenExport,
  rendering,
}: {
  slide: EditorSlide | null;
  voice: string;
  onVoiceChange: (v: string) => void;
  onOpenExport: () => void;
  /** True when a project-wide render is queued/running. */
  rendering: boolean;
}) {
  const slideId = slide?.id ?? null;
  const [regenInFlight, setRegenInFlight] = React.useState(false);
  const [voiceOpen, setVoiceOpen] = React.useState(false);

  // Track the script value at the moment we kicked off regen, so we can
  // detect "regen finished" via the parent's realtime-driven `slide.script`
  // diff. We don't own the script value here anymore; ScriptCard does.
  const regenStartScriptRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!regenInFlight || !slide) return;
    if (
      typeof slide.script === 'string' &&
      slide.script !== regenStartScriptRef.current
    ) {
      setRegenInFlight(false);
    }
  }, [slide, regenInFlight]);

  async function handleRegen() {
    if (!slideId || regenInFlight) return;
    regenStartScriptRef.current = slide?.script ?? null;
    setRegenInFlight(true);
    try {
      const res = await fetch(`/api/slides/${slideId}/regen`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTimeout(() => setRegenInFlight((v) => (v ? false : v)), REGEN_TIMEOUT_MS);
    } catch (e) {
      setRegenInFlight(false);
      toast.error('Regenerate failed', {
        description: e instanceof Error ? e.message : 'Try again.',
      });
    }
  }

  return (
    <aside
      className="flex h-full w-[296px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-[color:var(--hairline)] bg-[color:var(--paper)] px-4 py-4"
      aria-label="Slide settings"
    >
      {/* 1. Voice card */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink-4)]">
            Voice
          </span>
          <button
            type="button"
            className="text-[12px] font-medium text-[color:var(--ink-2)] hover:text-[color:var(--ink)]"
            onClick={() => setVoiceOpen(true)}
          >
            Change
          </button>
        </div>
        <button
          type="button"
          onClick={() => setVoiceOpen(true)}
          className="pp-card flex items-center gap-2.5 p-3 text-left transition-shadow duration-150 ease-out hover:shadow-floater"
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
            style={{
              background: 'linear-gradient(135deg, var(--accent-soft), var(--accent))',
            }}
          >
            {voiceLabel(voice)[0]}
          </div>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="t-13 truncate font-medium">{voiceLabel(voice)}</span>
            <span className="t-12 truncate text-[color:var(--ink-3)]">
              Applied at render time
            </span>
          </div>
          <span
            role="button"
            tabIndex={-1}
            aria-label="Play sample"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[color:var(--hairline-2)] text-[color:var(--ink-2)] hover:bg-[color:var(--paper-2)]"
          >
            <PlayIcon size={10} />
          </span>
        </button>
      </section>

      {/* 2. Slide settings card */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink-4)]">
          Slide settings
        </span>
        <div className="pp-card flex flex-col gap-3 p-4">
          <button
            type="button"
            onClick={handleRegen}
            disabled={!slideId || regenInFlight}
            className={cn(
              'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-150 ease-out',
              'bg-[color:var(--accent)] text-white shadow-[0_1px_2px_rgba(180,60,40,0.18),inset_0_1px_0_rgba(255,255,255,0.18)]',
              'hover:bg-[color:var(--accent-2)] disabled:opacity-50',
            )}
          >
            <Sparkles className="size-3.5" />
            {regenInFlight ? 'Regenerating' : 'Regenerate this slide'}
          </button>
          <div className="flex items-center justify-between">
            <span className="t-12 text-[color:var(--ink-3)]">Script source</span>
            {slide?.script_locked ? (
              <span className="pp-tag is-coral">Locked</span>
            ) : (
              <span className="pp-tag">Auto</span>
            )}
          </div>
        </div>
      </section>

      {/* 3. Render card */}
      <section className="mt-auto flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink-4)]">
          Render
        </span>
        <div className="pp-card flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[color:var(--accent-tint)] text-[color:var(--accent-2)]">
              <DiamondIcon size={14} />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="t-13 font-semibold">Render this video</span>
              <span className="t-12 text-[color:var(--ink-3)]">
                {rendering ? 'In progress' : 'Captions and quality next.'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenExport}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[color:var(--accent)] px-3 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(180,60,40,0.18),inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors duration-150 ease-out hover:bg-[color:var(--accent-2)]"
          >
            <SparkleIcon size={12} />
            {rendering ? 'Open progress' : 'Render'}
          </button>
        </div>
      </section>

      <VoiceLibraryOverlay
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        value={voice}
        onValueChange={onVoiceChange}
      />
    </aside>
  );
}
