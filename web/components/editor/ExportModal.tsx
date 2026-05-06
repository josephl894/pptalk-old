'use client';

/**
 * Loom-style export modal — Hi-Fi tokens, 560px width.
 *
 * Three lifecycle phases:
 *   A. Idle      — toggles + Render CTA. Captions (SRT) + Quality (720/1080).
 *   B. Rendering — determinate progress bar + live status.
 *   C. Done      — coral checkmark (the one delight moment) + size/duration
 *                  + Copy link / Download MP4.
 *
 * Out of scope this wave: 4K / MOV / Audio-only / burned-in captions /
 * background-render copy / credits. The toggles here are exactly the two
 * locked in `SCOPE-DEMO.md`.
 */

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { SparkleIcon } from '@/components/shell/icons';
import { SlideThumb } from '@/components/shell/SlideThumb';
import { voiceLabel } from './VoiceLibraryOverlay';
import type { EditorActiveJob, EditorLatestRender, EditorSlide } from './types';

type Quality = '720p' | '1080p';

export type ExportModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  numSlides: number;
  slidesForPreview: EditorSlide[];
  voice: string;
  activeJobs: EditorActiveJob[];
  latestRender: EditorLatestRender | null;
  onTriggerRender: (opts: {
    voice: string;
    captions: boolean;
    quality: Quality;
  }) => Promise<void>;
  onRefreshLatestRender: () => Promise<void>;
};

type Phase = 'idle' | 'rendering' | 'done';

function statusToPercent(status: string | undefined): number {
  switch (status) {
    case 'queued': return 5;
    case 'running': return 50;
    case 'done': return 100;
    case 'failed': return 0;
    default: return 0;
  }
}

function statusToLabel(status: string | undefined): string {
  switch (status) {
    case 'queued': return 'Queued';
    case 'running': return 'Rendering';
    case 'done': return 'Finalizing';
    case 'failed': return 'Failed';
    default: return 'Rendering';
  }
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(s: number | null | undefined): string {
  if (s == null || s <= 0) return '—';
  const total = Math.round(s);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------
// Internal subcomponents.
//
// Declared **before** <ExportModal> so they are unambiguously
// declare-before-use. Function declarations should hoist, but Next 15's
// HMR + RSC module wrapping has been seen to surface a transient
// "X is not defined" mid-recompile when the JSX call site sits above the
// function declaration. Putting helpers up here removes the ambiguity.
// ---------------------------------------------------------------------

function PreviewCard({
  slide,
  voice,
  numSlides,
  totalDurationS,
}: {
  slide: EditorSlide | null;
  voice: string;
  numSlides: number;
  totalDurationS: number;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-3"
    >
      <div className="w-[120px] shrink-0">
        {slide?.png_signed_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={slide.png_signed_url}
            alt=""
            className="aspect-video w-full rounded-[4px] border border-[color:var(--hairline)] object-cover"
          />
        ) : (
          <SlideThumb title={slide?.title ?? 'Slide'} kind="body" accent />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="t-13 font-medium">
          {numSlides} slide{numSlides === 1 ? '' : 's'}
          {totalDurationS > 0 && ` · est ${formatDuration(totalDurationS)}`}
        </div>
        <div className="t-12 text-[color:var(--ink-3)]">
          {voiceLabel(voice)} · MP4 native aspect
        </div>
        {/* Quiet waveform mock — dampens to reinforce the "voiced" feel
            without competing with the modal's primary CTA. */}
        <div className="flex items-center gap-[1px]" aria-hidden>
          {Array.from({ length: 36 }).map((_, i) => {
            const h = 3 + ((i * 7) % 9);
            return (
              <div
                key={i}
                style={{
                  width: 2,
                  height: h,
                  background: 'var(--ink-5)',
                  opacity: 0.55,
                  borderRadius: 1,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--hairline)] bg-[color:var(--paper)] px-3 py-2.5">
      <span className="t-13 font-medium">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 ease-out',
        checked ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--paper-3)]',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] inline-block h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.15)] transition-[left] duration-150 ease-out',
          checked ? 'left-[16px]' : 'left-[2px]',
        )}
      />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-[2px]">
      {options.map((o) => {
        const selected = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={cn(
              'rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors duration-150 ease-out',
              selected
                ? 'bg-[color:var(--paper)] text-[color:var(--ink)] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_var(--hairline)]'
                : 'text-[color:var(--ink-3)] hover:text-[color:var(--ink)]',
            )}
            aria-pressed={selected}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function IdleBody({
  captions,
  onCaptionsChange,
  quality,
  onQualityChange,
}: {
  captions: boolean;
  onCaptionsChange: (v: boolean) => void;
  quality: Quality;
  onQualityChange: (q: Quality) => void;
}) {
  return (
    <>
      <Row label="Captions (SRT sidecar)">
        <Toggle checked={captions} onChange={onCaptionsChange} />
      </Row>
      <Row label="Quality">
        <Segmented
          value={quality}
          options={['720p', '1080p']}
          onChange={onQualityChange}
        />
      </Row>
    </>
  );
}

function RenderingBody({
  statusLabel,
  percent,
}: {
  statusLabel: string;
  percent: number;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin text-[color:var(--ink-3)]" />
        <span className="t-13 font-medium">{statusLabel}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="pp-bar"
      >
        <div
          className="pp-fill transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </>
  );
}

function DelightCheckmark() {
  return (
    <div className="relative size-14">
      <style>{`
        @keyframes pp-check-scale {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes pp-check-draw {
          from { stroke-dashoffset: 24; }
          to   { stroke-dashoffset: 0; }
        }
        .pp-check-circle {
          animation: pp-check-scale 200ms ease-out forwards;
          transform-origin: 50% 50%;
        }
        .pp-check-stroke {
          stroke-dasharray: 24;
          stroke-dashoffset: 24;
          animation: pp-check-draw 150ms ease-out 80ms forwards;
        }
      `}</style>
      <svg viewBox="0 0 56 56" className="size-14" aria-hidden>
        <g className="pp-check-circle">
          <circle cx="28" cy="28" r="22" fill="var(--accent)" />
          <path
            d="M18 28.5 L25 35 L38 22"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pp-check-stroke"
          />
        </g>
      </svg>
    </div>
  );
}

function DoneBody({ render }: { render: NonNullable<EditorLatestRender> }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <DelightCheckmark />
      <div className="t-14 font-semibold">Your video is ready</div>
      <div className="flex items-center gap-2 text-[12px] text-[color:var(--ink-3)]">
        <span>{formatBytes(render.video_bytes)}</span>
        <span aria-hidden>·</span>
        <span>{formatDuration(render.video_duration_s)}</span>
        {render.captions && (
          <>
            <span aria-hidden>·</span>
            <span>captions</span>
          </>
        )}
      </div>
    </div>
  );
}

export function ExportModal({
  open,
  onOpenChange,
  projectId: _projectId,
  projectName,
  numSlides,
  slidesForPreview,
  voice,
  activeJobs,
  latestRender,
  onTriggerRender,
  onRefreshLatestRender,
}: ExportModalProps) {
  void _projectId;
  const previewSlide = slidesForPreview[0] ?? null;
  const totalDurationS = React.useMemo(() => {
    return slidesForPreview.reduce((acc, s) => acc + (s.audio_duration_s ?? 0), 0);
  }, [slidesForPreview]);
  const [captions, setCaptions] = React.useState(false);
  const [quality, setQuality] = React.useState<Quality>('1080p');
  const [optimisticRendering, setOptimisticRendering] = React.useState(false);
  const [acknowledgedRenderId, setAcknowledgedRenderId] = React.useState<string | null>(null);

  const fullRenderJobs = React.useMemo(
    () => activeJobs.filter((j) => j.kind === 'full_render'),
    [activeJobs],
  );
  const mostRecentJob: EditorActiveJob | undefined = React.useMemo(() => {
    if (fullRenderJobs.length === 0) return undefined;
    const active = fullRenderJobs.filter((j) => j.status === 'queued' || j.status === 'running');
    const pool = active.length > 0 ? active : fullRenderJobs;
    return [...pool].sort((a, b) => {
      const ad = new Date(a.updated_at).getTime();
      const bd = new Date(b.updated_at).getTime();
      return bd - ad;
    })[0];
  }, [fullRenderJobs]);

  const hasActiveRender =
    !!mostRecentJob && (mostRecentJob.status === 'queued' || mostRecentJob.status === 'running');

  const phase: Phase = React.useMemo(() => {
    if (hasActiveRender || optimisticRendering) return 'rendering';
    if (latestRender) return 'done';
    return 'idle';
  }, [hasActiveRender, optimisticRendering, latestRender]);

  React.useEffect(() => {
    if (!hasActiveRender && optimisticRendering) {
      const t = setTimeout(() => setOptimisticRendering(false), 50);
      return () => clearTimeout(t);
    }
  }, [hasActiveRender, optimisticRendering]);

  const refreshGuardRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open || phase !== 'done' || !latestRender) return;
    if (refreshGuardRef.current === latestRender.id) return;
    refreshGuardRef.current = latestRender.id;
    onRefreshLatestRender().catch(() => {});
  }, [open, phase, latestRender, onRefreshLatestRender]);

  React.useEffect(() => {
    if (!open || phase !== 'done' || !latestRender) return;
    if (acknowledgedRenderId !== latestRender.id) {
      setAcknowledgedRenderId(latestRender.id);
    }
  }, [open, phase, latestRender, acknowledgedRenderId]);

  async function handleRender() {
    setOptimisticRendering(true);
    try {
      await onTriggerRender({ voice, captions, quality });
    } catch {
      setOptimisticRendering(false);
    }
  }

  async function handleCopyLink() {
    if (!latestRender?.mp4_signed_url) return;
    try {
      await navigator.clipboard.writeText(latestRender.mp4_signed_url);
      toast.success('Link copied');
    } catch {
      toast.error('Copy failed', {
        description: 'Open in a new tab and copy from the address bar.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[560px] gap-0 overflow-hidden p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[color:var(--hairline)] px-5 py-3.5">
          <div className="flex flex-col leading-tight">
            <DialogTitle className="t-16 font-semibold">
              {phase === 'done' ? 'Ready' : phase === 'rendering' ? 'Rendering' : 'Render video'}
            </DialogTitle>
            <DialogDescription className="t-12 text-[color:var(--ink-3)]">
              {phase === 'done'
                ? 'Your video is ready to share.'
                : phase === 'rendering'
                ? 'This usually takes a minute or two.'
                : `${projectName} · ${numSlides} slides${
                    totalDurationS > 0 ? ` · est ${formatDuration(totalDurationS)}` : ''
                  }`}
            </DialogDescription>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          {phase === 'idle' && (
            <>
              <PreviewCard
                slide={previewSlide}
                voice={voice}
                numSlides={numSlides}
                totalDurationS={totalDurationS}
              />
              <IdleBody
                captions={captions}
                onCaptionsChange={setCaptions}
                quality={quality}
                onQualityChange={setQuality}
              />
            </>
          )}
          {phase === 'rendering' && (
            <RenderingBody
              statusLabel={statusToLabel(mostRecentJob?.status)}
              percent={mostRecentJob ? statusToPercent(mostRecentJob.status) : 5}
            />
          )}
          {phase === 'done' && latestRender && <DoneBody render={latestRender} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--hairline)] bg-[color:var(--paper-2)] px-5 py-3">
          {phase === 'idle' && (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-7 items-center rounded-md border border-[color:var(--hairline-2)] bg-[color:var(--paper)] px-2.5 text-[12px] font-medium hover:bg-[color:var(--paper-2)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRender}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-[color:var(--accent)] px-3 text-[12px] font-medium text-white shadow-[0_1px_2px_rgba(180,60,40,0.18),inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-[color:var(--accent-2)]"
              >
                <SparkleIcon size={12} />
                Start render
              </button>
            </>
          )}
          {phase === 'rendering' && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-7 items-center rounded-md border border-[color:var(--hairline-2)] bg-[color:var(--paper)] px-2.5 text-[12px] font-medium hover:bg-[color:var(--paper-2)]"
            >
              Hide
            </button>
          )}
          {phase === 'done' && latestRender && (
            <>
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex h-7 items-center rounded-md border border-[color:var(--hairline-2)] bg-[color:var(--paper)] px-2.5 text-[12px] font-medium hover:bg-[color:var(--paper-2)]"
              >
                Copy link
              </button>
              <a
                href={latestRender.mp4_signed_url}
                download
                className="inline-flex h-7 items-center rounded-md bg-[color:var(--accent)] px-3 text-[12px] font-medium text-white shadow-[0_1px_2px_rgba(180,60,40,0.18),inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-[color:var(--accent-2)]"
              >
                Download MP4
              </a>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// (helpers moved above ExportModal — see top of file)
