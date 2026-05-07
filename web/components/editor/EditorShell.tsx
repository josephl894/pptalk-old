'use client';

/**
 * Editor surface — Hi-Fi top chrome + 3-pane body.
 *
 * Layout (CSS grid, full viewport):
 *
 *   ┌─ topbar (52px) ──────────────────────────────────────────────┐
 *   ├─ rail (168px) ─┬─ center (1fr) ─┬─ right (296px) ───────────┤
 *   └────────────────┴────────────────┴────────────────────────────┘
 *
 * Editor lives outside the (shell) sidebar group — it gets its own full-bleed
 * topbar. Center pane stacks SlidePreview + ScriptCard. Right pane is three
 * stacked cards (Voice / Slide settings / Render) per the Wave 2 spec.
 *
 * The render-complete checkmark in <ExportModal> is the one designated
 * delight moment; no separate banner.
 */

import * as React from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { toast } from 'sonner';

import { useProjectRealtime } from '@/lib/realtime/useProjectRealtime';
import { OutlineIcon, SparkleIcon } from '@/components/shell/icons';
import { AutoSaveChip, type AutoSaveState } from './AutoSaveChip';
import { SlidePreview } from './SlidePreview';
import { ScriptCard } from './ScriptCard';
import { ScriptPanel } from './ScriptPanel';
import { ExportModal } from './ExportModal';
import { EditorOverviewOverlay } from './EditorOverviewOverlay';

// dnd-kit uses a module-level counter for `DndDescribedBy-N` ids that doesn't
// reconcile between SSR and CSR — the SSR pass accumulates a different N than
// the fresh client, so we'd hydrate-mismatch on `aria-describedby`. Skipping
// SSR for the rail makes dnd-kit run client-only. The `loading` placeholder
// reserves the rail's 168px column so layout doesn't shift on hydration.
const SceneRail = dynamic(
  () => import('./SceneRail').then((m) => m.SceneRail),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-full w-[168px] shrink-0 border-r border-[color:var(--hairline)] bg-[color:var(--paper)]"
        aria-label="Slide rail"
      />
    ),
  },
);
import type {
  EditorActiveJob,
  EditorLatestRender,
  EditorProject,
  EditorSlide,
} from './types';

type RealtimePayload = {
  eventType?: 'INSERT' | 'UPDATE' | 'DELETE';
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
};

const DEFAULT_VOICE = 'alloy';

export function EditorShell({
  initialProject,
  initialSlides,
  initialActiveJobs,
  initialLatestRender,
}: {
  initialProject: EditorProject;
  initialSlides: EditorSlide[];
  initialActiveJobs: EditorActiveJob[];
  initialLatestRender: EditorLatestRender;
}) {
  const [project, setProject] = React.useState<EditorProject>(initialProject);
  const [slides, setSlides] = React.useState<EditorSlide[]>(initialSlides);
  const [activeJobs, setActiveJobs] =
    React.useState<EditorActiveJob[]>(initialActiveJobs);
  const [latestRender, setLatestRender] =
    React.useState<EditorLatestRender>(initialLatestRender);

  const [selectedSlideId, setSelectedSlideId] = React.useState<string | null>(
    initialSlides[0]?.id ?? null,
  );

  const initialVoice = React.useMemo<string>(() => {
    return initialSlides.find((s) => s.voice)?.voice ?? DEFAULT_VOICE;
  }, [initialSlides]);
  const [voice, setVoice] = React.useState<string>(initialVoice);

  // Persist voice on every change. The schema stores voice per-slide (no
  // `projects.voice` column), so the API bulk-writes to all `slides.voice`
  // rows. Voice is derived from the first slide on next page load.
  const handleVoiceChange = React.useCallback(
    (next: string) => {
      const previous = voice;
      if (next === previous) return;
      setVoice(next);
      void (async () => {
        try {
          const res = await fetch(`/api/projects/${project.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ voice: next }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
          setVoice(previous);
          toast.error('Voice change failed', {
            description: e instanceof Error ? e.message : 'Try again.',
          });
        }
      })();
    },
    [voice, project.id],
  );

  const [autoSave, setAutoSave] = React.useState<AutoSaveState>('idle');

  const [renaming, setRenaming] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(initialProject.name);

  const [exportOpen, setExportOpen] = React.useState(false);
  const [outlineOpen, setOutlineOpen] = React.useState(false);

  // Inline play of a slide's audio. One <audio> at a time — playing a new
  // slide pauses the previous.
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playingSlideId, setPlayingSlideId] = React.useState<string | null>(null);

  function playSlideAudio(slide: EditorSlide) {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        /* ignore */
      }
    }
    if (playingSlideId === slide.id) {
      setPlayingSlideId(null);
      return;
    }
    if (!slide.audio_signed_url) return;
    const a = new Audio(slide.audio_signed_url);
    audioRef.current = a;
    a.onended = () => setPlayingSlideId((p) => (p === slide.id ? null : p));
    a.onerror = () => setPlayingSlideId((p) => (p === slide.id ? null : p));
    setPlayingSlideId(slide.id);
    a.play().catch(() => setPlayingSlideId((p) => (p === slide.id ? null : p)));
  }

  React.useEffect(() => {
    setNameDraft(project.name);
  }, [project.name]);

  // ---------------------------------------------------------------------
  // Realtime
  // ---------------------------------------------------------------------

  const handlers = React.useMemo(
    () => ({
      onSlideChange: (raw: unknown) => {
        const payload = raw as RealtimePayload;
        const newRow = payload?.new as Record<string, unknown> | null;
        const oldRow = payload?.old as Record<string, unknown> | null;
        if (payload?.eventType === 'DELETE') {
          const id = (oldRow?.id ?? newRow?.id) as string | undefined;
          if (!id) return;
          setSlides((prev) => prev.filter((s) => s.id !== id));
          return;
        }
        if (!newRow) return;
        const id = newRow.id as string;
        setSlides((prev) => {
          const existing = prev.find((s) => s.id === id);
          if (!existing) return prev;
          const patched: EditorSlide = {
            ...existing,
            idx: typeof newRow.idx === 'number' ? newRow.idx : existing.idx,
            title:
              typeof newRow.title === 'string' || newRow.title === null
                ? (newRow.title as string | null)
                : existing.title,
            script:
              typeof newRow.script === 'string' || newRow.script === null
                ? (newRow.script as string | null)
                : existing.script,
            script_locked:
              typeof newRow.script_locked === 'boolean'
                ? newRow.script_locked
                : existing.script_locked,
            voice:
              typeof newRow.voice === 'string' || newRow.voice === null
                ? (newRow.voice as string | null)
                : existing.voice,
            audio_duration_s:
              typeof newRow.audio_duration_s === 'number' ||
              newRow.audio_duration_s === null
                ? (newRow.audio_duration_s as number | null)
                : existing.audio_duration_s,
          };
          const next = prev.map((s) => (s.id === id ? patched : s));
          next.sort((a, b) => a.idx - b.idx);
          return next;
        });
      },
      onJobChange: (raw: unknown) => {
        const payload = raw as RealtimePayload;
        const newRow = payload?.new as Record<string, unknown> | null;
        const oldRow = payload?.old as Record<string, unknown> | null;
        if (payload?.eventType === 'DELETE') {
          const id = (oldRow?.id ?? newRow?.id) as string | undefined;
          if (!id) return;
          setActiveJobs((prev) => prev.filter((j) => j.id !== id));
          return;
        }
        if (!newRow) return;
        const job: EditorActiveJob = {
          id: newRow.id as string,
          kind: newRow.kind as string,
          status: newRow.status as string,
          payload: newRow.payload,
          attempts: (newRow.attempts as number) ?? 0,
          error: (newRow.error as string | null) ?? null,
          created_at: (newRow.created_at as string) ?? new Date().toISOString(),
          updated_at: (newRow.updated_at as string) ?? new Date().toISOString(),
        };
        const isActive = job.status === 'queued' || job.status === 'running';
        setActiveJobs((prev) => {
          const without = prev.filter((j) => j.id !== job.id);
          return isActive ? [...without, job] : without;
        });
        if (job.kind === 'full_render' && job.status === 'done') {
          refreshLatestRender();
        }
      },
      onProjectChange: (raw: unknown) => {
        const payload = raw as RealtimePayload;
        const newRow = payload?.new as Record<string, unknown> | null;
        if (!newRow) return;
        setProject((prev) => ({
          ...prev,
          name: typeof newRow.name === 'string' ? newRow.name : prev.name,
          status: typeof newRow.status === 'string' ? newRow.status : prev.status,
          num_slides:
            typeof newRow.num_slides === 'number' ? newRow.num_slides : prev.num_slides,
          aspect_w:
            typeof newRow.aspect_w === 'number' || newRow.aspect_w === null
              ? (newRow.aspect_w as number | null)
              : prev.aspect_w,
          aspect_h:
            typeof newRow.aspect_h === 'number' || newRow.aspect_h === null
              ? (newRow.aspect_h as number | null)
              : prev.aspect_h,
        }));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useProjectRealtime(project.id, handlers);

  async function refreshLatestRender() {
    try {
      const res = await fetch(`/api/projects/${project.id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.latest_render) setLatestRender(data.latest_render as EditorLatestRender);
    } catch {
      /* best-effort */
    }
  }

  // ---------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------

  const selectedSlide =
    slides.find((s) => s.id === selectedSlideId) ?? slides[0] ?? null;

  const renderJob = activeJobs.find(
    (j) =>
      j.kind === 'full_render' && (j.status === 'queued' || j.status === 'running'),
  );
  const rendering = !!renderJob;

  const parseJob = activeJobs.find((j) => j.kind === 'parse_only');
  const parsing = project.status === 'parsing';

  // Re-tick periodically while a parse job is queued so the "worker stalled"
  // banner appears on time without needing a new event from the server.
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (!parseJob || parseJob.status !== 'queued') return;
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, [parseJob?.id, parseJob?.status]);

  const workerStalled = React.useMemo(() => {
    if (!parseJob || parseJob.status !== 'queued') return false;
    const created =
      typeof parseJob.created_at === 'string'
        ? Date.parse(parseJob.created_at)
        : new Date(parseJob.created_at).getTime();
    if (!Number.isFinite(created)) return false;
    return now - created > 30_000;
  }, [parseJob?.id, parseJob?.status, parseJob?.created_at, now]);

  const hasSpeakerNotes = !!selectedSlide?.speaker_notes?.trim();

  // ---------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------

  async function handleRename() {
    const next = nameDraft.trim();
    setRenaming(false);
    if (!next || next === project.name) {
      setNameDraft(project.name);
      return;
    }
    const previous = project.name;
    setProject((p) => ({ ...p, name: next }));
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setProject((p) => ({ ...p, name: previous }));
      setNameDraft(previous);
      toast.error('Rename failed', {
        description: e instanceof Error ? e.message : 'Try again.',
      });
    }
  }

  async function handleReorder(orderedIds: string[]) {
    const previous = slides;
    const indexMap = new Map(orderedIds.map((id, i) => [id, i]));
    const next = [...slides]
      .map((s) => ({ ...s, idx: indexMap.get(s.id) ?? s.idx }))
      .sort((a, b) => a.idx - b.idx);
    setSlides(next);
    try {
      const res = await fetch('/api/slides/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          ordered_slide_ids: orderedIds,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setSlides(previous);
      toast.error('Reorder failed', {
        description: e instanceof Error ? e.message : 'Try again.',
      });
    }
  }

  async function handleRender(opts?: {
    voice?: string;
    captions?: boolean;
    quality?: '720p' | '1080p';
  }) {
    const renderVoice = opts?.voice ?? voice;
    const payload: Record<string, unknown> = {
      project_id: project.id,
      voice: renderVoice,
    };
    if (typeof opts?.captions === 'boolean') payload.captions = opts.captions;
    if (opts?.quality) payload.quality = opts.quality;
    try {
      const res = await fetch('/api/renders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { job_id: string };
      setActiveJobs((prev) => [
        ...prev,
        {
          id: data.job_id,
          kind: 'full_render',
          status: 'queued',
          payload: { voice: renderVoice },
          attempts: 0,
          error: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
    } catch (e) {
      toast.error('Render failed to start', {
        description: e instanceof Error ? e.message : 'Try again.',
      });
      throw e;
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const showWorkerNotice = workerStalled;
  const showParsingNotice = parsing && !workerStalled;
  const banner = showWorkerNotice || showParsingNotice;

  return (
    <div
      className="grid h-screen w-screen overflow-hidden bg-[color:var(--paper-2)]"
      style={{
        // `minmax(0, 1fr)` instead of `1fr` so neither the body row nor the
        // center column inflates to its content's intrinsic size — the slide
        // image at 1080px high would otherwise push the row past 100vh and
        // hide content under the fold.
        gridTemplateRows: banner ? '52px auto minmax(0, 1fr)' : '52px minmax(0, 1fr)',
        gridTemplateColumns: '168px minmax(0, 1fr) 296px',
      }}
    >
      <header
        className="pp-topbar col-span-3"
        style={{ gridColumn: '1 / 4', paddingLeft: 20 }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="t-13 inline-flex shrink-0 items-center gap-1 text-[color:var(--ink-3)] transition-colors duration-150 ease-out hover:text-[color:var(--ink)]"
          >
            ← Home
          </Link>
          <span className="h-4 w-px bg-[color:var(--hairline)]" aria-hidden />
          <div className="flex min-w-0 flex-col leading-tight">
            {renaming ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === 'Escape') {
                    setNameDraft(project.name);
                    setRenaming(false);
                  }
                }}
                className="t-14 max-w-[320px] truncate rounded-sm border-0 bg-transparent px-0 font-semibold outline-none focus:ring-0"
              />
            ) : (
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="t-14 truncate text-left font-semibold transition-colors duration-150 ease-out hover:text-[color:var(--ink-1)]"
                title="Click to rename"
              >
                {project.name}
              </button>
            )}
            <div className="t-12 text-[color:var(--ink-3)]">
              {slides.length} slides · saved <RelativeSaved state={autoSave} />
            </div>
          </div>
          {!latestRender && (
            <span className="pp-tag is-outline" style={{ marginLeft: 8 }}>
              Draft
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <AutoSaveChip state={autoSave} />
          <button
            type="button"
            onClick={() => setOutlineOpen(true)}
            aria-label="Show all slides"
            title="Show all slides"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--ink-3)] transition-colors duration-150 ease-out hover:bg-[color:var(--paper-2)] hover:text-[color:var(--ink)]"
          >
            <OutlineIcon size={14} />
          </button>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            aria-busy={rendering}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-[color:var(--accent)] px-3 text-[12px] font-medium text-white shadow-[0_1px_2px_rgba(180,60,40,0.18),inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors duration-150 ease-out hover:bg-[color:var(--accent-2)]"
          >
            <SparkleIcon size={12} />
            {rendering ? 'Rendering' : 'Render'}
          </button>
        </div>
      </header>

      {banner && (
        <div
          role={showWorkerNotice ? 'alert' : undefined}
          data-testid={
            showWorkerNotice
              ? 'worker-not-available'
              : 'parse-in-progress'
          }
          style={{ gridColumn: '1 / 4' }}
          className="flex items-start gap-3 border-b border-[color:var(--hairline)] bg-[color:var(--paper)] px-5 py-3"
        >
          {showWorkerNotice ? (
            <>
              <div
                aria-hidden
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent-tint)] text-[color:var(--accent-2)]"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 1.5v4.5" />
                  <circle cx="6" cy="9" r="0.6" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="t-13 font-medium text-[color:var(--ink)]">
                  Render worker is not running
                </div>
                <div className="t-12 mt-0.5 text-[color:var(--ink-3)]">
                  Slides will start parsing as soon as the worker is up. From the
                  pipeline directory, run{' '}
                  <code className="rounded bg-[color:var(--paper-2)] px-1 py-0.5 font-mono text-[11px]">
                    uv run narrator worker
                  </code>
                  . Your upload is safe — the queued job will be picked up automatically.
                </div>
              </div>
            </>
          ) : (
            <>
              <div
                aria-hidden
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 animate-pulse items-center justify-center rounded-full bg-[color:var(--paper-2)] text-[color:var(--ink-3)]"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="6" r="3.5" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="t-13 font-medium text-[color:var(--ink)]">
                  Parsing your deck…
                </div>
                <div className="t-12 mt-0.5 text-[color:var(--ink-3)]">
                  Slides will appear here as soon as parse finishes.
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <SceneRail
        slides={slides}
        selectedId={selectedSlide?.id ?? null}
        onSelect={setSelectedSlideId}
        onReorder={handleReorder}
        onPlay={playSlideAudio}
        playingSlideId={playingSlideId}
      />

      {/* Center column: 2-row sub-grid so the slide preview takes the
          remaining viewport while ScriptCard stays anchored at the bottom,
          always visible without scrolling. The previous flex+overflow-y-auto
          let the slide consume the full height and pushed the script editor
          below the fold. */}
      <div
        className="grid min-h-0 min-w-0 gap-4 bg-[color:var(--paper-2)] p-6"
        style={{ gridTemplateRows: 'minmax(0, 1fr) auto' }}
      >
        <div className="flex min-h-0 items-stretch overflow-hidden">
          <SlidePreview
            slide={selectedSlide}
            aspectW={project.aspect_w}
            aspectH={project.aspect_h}
            generated={!hasSpeakerNotes}
          />
        </div>
        <ScriptCard slide={selectedSlide} onSaveStatus={setAutoSave} />
      </div>

      <ScriptPanel
        slide={selectedSlide}
        voice={voice}
        onVoiceChange={handleVoiceChange}
        onOpenExport={() => setExportOpen(true)}
        rendering={rendering}
      />

      <ExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        projectId={project.id}
        projectName={project.name}
        numSlides={project.num_slides}
        slidesForPreview={slides}
        voice={voice}
        activeJobs={activeJobs}
        latestRender={latestRender}
        onTriggerRender={handleRender}
        onRefreshLatestRender={refreshLatestRender}
      />

      <EditorOverviewOverlay
        open={outlineOpen}
        onOpenChange={setOutlineOpen}
        projectId={project.id}
        slides={slides}
        voice={voice}
        onSelectSlide={setSelectedSlideId}
      />
    </div>
  );
}

function RelativeSaved({ state }: { state: AutoSaveState }) {
  if (state === 'saving') return <span>now</span>;
  if (state === 'saved') return <span>just now</span>;
  if (state === 'failed') return <span>—</span>;
  return <span>—</span>;
}
