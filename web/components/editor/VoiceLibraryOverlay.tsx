'use client';

/**
 * Voice library overlay — Hi-Fi pattern, scoped to our 6 OpenAI voices.
 *
 * Layout: ~1080×720 dialog with three sections —
 *   - header: title + counts + close
 *   - left rail: tone group facets (Authoritative / Warm / Energetic)
 *   - grid: 3-col voice cards with avatar + waveform + play
 *
 * No language/accent/gender facets (we have one language, six voices).
 * No search (overkill for six items).
 * No "currently in use" copy that implies per-slide override (we apply
 * project-wide on render).
 *
 * Default selected = Alloy. Voice copy locked per `hats/content.md`.
 */

import * as React from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PlayIcon } from '@/components/shell/icons';

type Group = 'Authoritative' | 'Warm' | 'Energetic';

type Voice = {
  codename: 'onyx' | 'echo' | 'fable' | 'shimmer' | 'nova' | 'alloy';
  group: Group;
  /** User-facing friendly name (capitalized codename, e.g. "Alloy"). */
  name: string;
  /** Role line shown below the name (e.g. "Neutral Narrator — Balanced, default"). */
  subtitle: string;
};

const VOICES: Voice[] = [
  { codename: 'onyx', group: 'Authoritative', name: 'Onyx', subtitle: 'Executive Male — Deep, authoritative · finance, exec briefings' },
  { codename: 'echo', group: 'Authoritative', name: 'Echo', subtitle: 'Technical Male — Calm, precise · engineering, how-to' },
  { codename: 'fable', group: 'Warm', name: 'Fable', subtitle: 'British Male Narrator — Warm, storyteller · case-based teaching' },
  { codename: 'shimmer', group: 'Warm', name: 'Shimmer', subtitle: 'Mentor Female — Warm, approachable · healthcare, coaching' },
  { codename: 'nova', group: 'Energetic', name: 'Nova', subtitle: 'Course Host Female — Bright, engaging · course intros' },
  { codename: 'alloy', group: 'Energetic', name: 'Alloy', subtitle: 'Neutral Narrator — Balanced, default · generalist' },
];

const GROUP_ORDER: Group[] = ['Authoritative', 'Warm', 'Energetic'];

function findVoice(codename: string): Voice {
  return VOICES.find((v) => v.codename === codename) ?? VOICES[5]; // alloy
}

/**
 * Public URL for a voice preview sample stored in the `voice-samples`
 * Supabase Storage bucket. The bucket is public-read, so no signed URL is
 * needed — clients compose the URL from `NEXT_PUBLIC_SUPABASE_URL`.
 *
 * Literal `process.env.NEXT_PUBLIC_*` access is required for webpack to
 * inline the value into the client bundle (see `hats/engineering.md`
 * patterns and pitfalls #2). Bracket access would silently resolve to
 * `undefined` in the browser.
 */
export function voiceSampleUrl(codename: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return `${base}/storage/v1/object/public/voice-samples/${codename}.mp3`;
}

export function VoiceLibraryOverlay({
  open,
  onOpenChange,
  value,
  onValueChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (codename: string) => void;
}) {
  const [groupFilter, setGroupFilter] = React.useState<Group | 'All'>('All');
  const [tentative, setTentative] = React.useState<string>(value);
  const [previewing, setPreviewing] = React.useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    if (open) setTentative(value);
  }, [open, value]);

  const visible = React.useMemo(
    () => (groupFilter === 'All' ? VOICES : VOICES.filter((v) => v.group === groupFilter)),
    [groupFilter],
  );

  function previewVoice(codename: string) {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        /* ignore */
      }
    }
    if (previewing === codename) {
      setPreviewing(null);
      return;
    }
    const a = new Audio(voiceSampleUrl(codename));
    audioRef.current = a;
    a.onended = () => setPreviewing((p) => (p === codename ? null : p));
    setPreviewing(codename);
    // Single toast path: `play()` rejects when the source is missing, before
    // `onerror` would also fire — handling both produced duplicate toasts.
    a.play().catch(() => {
      setPreviewing((p) => (p === codename ? null : p));
      toast('Voice sample not available yet', {
        description: 'Selection still applies on render.',
      });
    });
  }

  React.useEffect(() => {
    if (!open && audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        /* ignore */
      }
      setPreviewing(null);
    }
  }, [open]);

  function commit() {
    onValueChange(tentative);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[1080px] gap-0 p-0 sm:rounded-md">
        <DialogTitle className="sr-only">Voice library</DialogTitle>
        <DialogDescription className="sr-only">
          Pick a voice for this project.
        </DialogDescription>

        <div className="flex h-[720px] max-h-[88vh] flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[color:var(--hairline)] px-5 py-3.5">
            <div className="flex flex-col leading-tight">
              <span className="t-16 font-semibold">Voice library</span>
              <span className="t-12 text-[color:var(--ink-3)]">
                {VOICES.length} voices · grouped by tone
              </span>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Left rail — group facets */}
            <div className="w-[200px] shrink-0 border-r border-[color:var(--hairline)] bg-[color:var(--paper)] p-3">
              <div className="px-1.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink-4)]">
                Tone
              </div>
              <FacetButton
                label="All"
                count={VOICES.length}
                active={groupFilter === 'All'}
                onClick={() => setGroupFilter('All')}
              />
              {GROUP_ORDER.map((g) => (
                <FacetButton
                  key={g}
                  label={g}
                  count={VOICES.filter((v) => v.group === g).length}
                  active={groupFilter === g}
                  onClick={() => setGroupFilter(g)}
                />
              ))}
            </div>

            {/* Grid */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-[color:var(--hairline)] px-5 py-3">
                <div className="flex items-center gap-1.5">
                  {groupFilter !== 'All' && (
                    <span className="pp-tag is-coral">{groupFilter}</span>
                  )}
                  <span className="pp-tag">{visible.length} voices</span>
                </div>
                <div className="t-12 text-[color:var(--ink-3)]">
                  Default voice: Alloy
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3.5 overflow-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((v) => {
                  const selected = tentative === v.codename;
                  const isPreview = previewing === v.codename;
                  return (
                    // Card is a div with a select button + a sibling preview
                    // button. Nesting the preview inside the select button
                    // (the prior shape) created an interactive-in-interactive
                    // markup that swallowed the inner click handler in some
                    // browsers — symptom: "the play button does nothing."
                    <div
                      key={v.codename}
                      className={cn(
                        'pp-card flex flex-col gap-3 p-3.5 transition-shadow duration-150 ease-out hover:shadow-floater',
                      )}
                      style={
                        selected
                          ? {
                              boxShadow:
                                '0 0 0 1.5px var(--accent), 0 4px 12px rgba(20,18,12,0.08)',
                              borderColor: 'transparent',
                            }
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setTentative(v.codename)}
                          aria-pressed={selected}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                            style={{
                              background: selected
                                ? 'linear-gradient(135deg, var(--accent-soft), var(--accent))'
                                : 'var(--paper-3)',
                              color: selected ? '#fff' : 'var(--ink-2)',
                            }}
                          >
                            {v.name[0]}
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col leading-tight">
                            <div className="flex items-center gap-1.5">
                              <span className="t-14 truncate font-medium">{v.name}</span>
                              {selected && (
                                <span className="pp-tag is-coral text-[10px]" style={{ height: 16, padding: '0 5px' }}>
                                  In use
                                </span>
                              )}
                            </div>
                            <div className="t-12 truncate text-[color:var(--ink-3)]">
                              {v.subtitle}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label={`Preview ${v.name}`}
                          onClick={() => previewVoice(v.codename)}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[color:var(--hairline-2)] bg-[color:var(--paper)] text-[color:var(--ink-2)] hover:bg-[color:var(--paper-2)]"
                        >
                          <PlayIcon size={10} />
                        </button>
                      </div>
                      <Waveform active={selected || isPreview} seed={v.codename} />
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-[color:var(--hairline)] px-5 py-3">
                <span className="t-12 text-[color:var(--ink-3)]">
                  Voice change applies to every slide on the next render.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    className="inline-flex h-7 items-center rounded-md border border-[color:var(--hairline-2)] bg-[color:var(--paper)] px-2.5 text-[12px] font-medium hover:bg-[color:var(--paper-2)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={commit}
                    disabled={tentative === value}
                    className="inline-flex h-7 items-center rounded-md bg-[color:var(--accent)] px-3 text-[12px] font-medium text-white shadow-[0_1px_2px_rgba(180,60,40,0.18),inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-[color:var(--accent-2)] disabled:opacity-50"
                  >
                    {/* Default copy: "Use Alloy" — voice friendly name comes from VOICES table. */}
                    Use {findVoice(tentative).name}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FacetButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[13px] transition-colors duration-150 ease-out',
        active
          ? 'bg-[color:var(--paper-2)] font-medium text-[color:var(--ink)]'
          : 'text-[color:var(--ink-2)] hover:bg-[color:var(--paper-2)]',
      )}
    >
      <span>{label}</span>
      <span className="ml-auto text-[12px] text-[color:var(--ink-4)]">{count}</span>
    </button>
  );
}

function Waveform({ active, seed }: { active: boolean; seed: string }) {
  // Deterministic pseudo-random heights from seed so each voice has a stable shape.
  const bars = React.useMemo(() => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return Array.from({ length: 46 }).map((_, k) => {
      h = (h * 1664525 + 1013904223) >>> 0;
      return 4 + ((h >>> 16) % 22);
    });
  }, [seed]);
  return (
    <div className="flex h-7 items-center gap-[1.5px]">
      {bars.map((height, i) => (
        <div
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height,
            background: active ? 'var(--accent)' : 'var(--ink-5)',
            opacity: active ? 0.85 : 0.5,
          }}
        />
      ))}
    </div>
  );
}

export function voiceLabel(codename: string): string {
  return findVoice(codename).name;
}
