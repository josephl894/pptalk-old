'use client';

import { useCallback, useRef, useState } from 'react';

type Phase = 'parse' | 'rasterize' | 'summarize' | 'narrate' | 'tts' | 'encode';

const PHASES: { key: Phase; label: string }[] = [
  { key: 'parse', label: 'Parse deck' },
  { key: 'rasterize', label: 'Rasterize slides' },
  { key: 'summarize', label: 'Summarize deck' },
  { key: 'narrate', label: 'Generate narration' },
  { key: 'tts', label: 'Synthesize audio' },
  { key: 'encode', label: 'Encode video' },
];

const VOICES = ['onyx', 'nova', 'shimmer', 'alloy', 'echo', 'fable'];

type SlideEvent = { phase: Phase; index: number; title?: string; preview?: string };

type DoneEvent = {
  out: string;
  wall_clock: number;
  cost_usd: number;
  video_duration: number;
  video_bytes: number;
};

type State =
  | { kind: 'idle' }
  | { kind: 'rendering' }
  | { kind: 'done'; result: DoneEvent }
  | { kind: 'error'; message: string };

export default function Studio() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [phaseStatus, setPhaseStatus] = useState<Record<Phase, 'pending' | 'active' | 'done'>>({
    parse: 'pending',
    rasterize: 'pending',
    summarize: 'pending',
    narrate: 'pending',
    tts: 'pending',
    encode: 'pending',
  });
  const [phaseDurations, setPhaseDurations] = useState<Record<string, number>>({});
  const [totalSlides, setTotalSlides] = useState<number | null>(null);
  const [slideCounts, setSlideCounts] = useState<Record<Phase, number>>({
    parse: 0,
    rasterize: 0,
    summarize: 0,
    narrate: 0,
    tts: 0,
    encode: 0,
  });
  const [recentSlides, setRecentSlides] = useState<SlideEvent[]>([]);
  const [voice, setVoice] = useState('onyx');
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setState({ kind: 'idle' });
    setPhaseStatus({
      parse: 'pending',
      rasterize: 'pending',
      summarize: 'pending',
      narrate: 'pending',
      tts: 'pending',
      encode: 'pending',
    });
    setPhaseDurations({});
    setTotalSlides(null);
    setSlideCounts({ parse: 0, rasterize: 0, summarize: 0, narrate: 0, tts: 0, encode: 0 });
    setRecentSlides([]);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submit = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setState({ kind: 'rendering' });

      const fd = new FormData();
      fd.append('file', file);
      fd.append('voice', voice);

      const res = await fetch('/api/render', { method: 'POST', body: fd });
      if (!res.ok || !res.body) {
        setState({
          kind: 'error',
          message: `Server returned ${res.status} ${res.statusText}`,
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split('\n\n');
        buffer = messages.pop() ?? '';
        for (const msg of messages) {
          if (!msg.startsWith('data: ')) continue;
          const json = msg.slice(6).trim();
          if (!json) continue;
          let evt: any;
          try { evt = JSON.parse(json); } catch { continue; }

          if (evt.event === 'phase_start') {
            setPhaseStatus((prev) => ({ ...prev, [evt.phase as Phase]: 'active' }));
            if (typeof evt.total === 'number') setTotalSlides(evt.total);
          } else if (evt.event === 'phase_done') {
            setPhaseStatus((prev) => ({ ...prev, [evt.phase as Phase]: 'done' }));
            setPhaseDurations((prev) => ({ ...prev, [evt.phase]: evt.duration }));
          } else if (evt.event === 'slide_done') {
            setSlideCounts((prev) => ({
              ...prev,
              [evt.phase as Phase]: (prev[evt.phase as Phase] ?? 0) + 1,
            }));
            if (evt.preview) {
              setRecentSlides((prev) => [
                { phase: evt.phase, index: evt.index, title: evt.title, preview: evt.preview },
                ...prev,
              ].slice(0, 6));
            }
          } else if (evt.event === 'done') {
            setState({ kind: 'done', result: evt });
          } else if (evt.event === 'error') {
            setState({ kind: 'error', message: evt.message });
          }
        }
      }
    },
    [voice],
  );

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) submit(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) submit(file);
  };

  return (
    <div className="space-y-8">
      {state.kind === 'idle' && (
        <UploadZone
          dragOver={dragOver}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          voice={voice}
          setVoice={setVoice}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx"
        className="hidden"
        onChange={onPick}
      />

      {(state.kind === 'rendering' || state.kind === 'done' || state.kind === 'error') && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between text-sm">
            <div className="text-zinc-700">
              <span className="font-medium">{fileName}</span>
              {totalSlides && <span className="text-zinc-400"> · {totalSlides} slides</span>}
            </div>
            {state.kind !== 'rendering' && (
              <button
                onClick={reset}
                className="text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
              >
                New deck
              </button>
            )}
          </div>

          <ol className="space-y-3">
            {PHASES.map(({ key, label }) => {
              const status = phaseStatus[key];
              const count = slideCounts[key];
              const duration = phaseDurations[key];
              return (
                <li key={key} className="flex items-start gap-3">
                  <PhaseDot status={status} />
                  <div className="flex-1">
                    <div className="flex items-baseline justify-between">
                      <span
                        className={
                          status === 'done'
                            ? 'text-zinc-500 line-through decoration-zinc-300'
                            : status === 'active'
                            ? 'text-zinc-900 font-medium'
                            : 'text-zinc-400'
                        }
                      >
                        {label}
                        {status === 'active' && (key === 'narrate' || key === 'tts') && totalSlides != null && (
                          <span className="ml-2 text-xs text-zinc-500">
                            {count}/{totalSlides}
                          </span>
                        )}
                      </span>
                      {duration != null && (
                        <span className="text-xs text-zinc-400">{duration.toFixed(1)}s</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {recentSlides.length > 0 && state.kind === 'rendering' && (
            <div className="mt-6 border-t border-zinc-100 pt-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">
                Latest narration
              </div>
              <ul className="space-y-2 text-sm text-zinc-600">
                {recentSlides.map((s, i) => (
                  <li key={`${s.phase}-${s.index}-${i}`} className="leading-snug">
                    <span className="text-zinc-400">Slide {s.index}:</span>{' '}
                    {s.preview}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.kind === 'done' && (
            <Result result={state.result} />
          )}
          {state.kind === 'error' && (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <div className="font-medium">Render failed</div>
              <div className="mt-1 text-red-600/80">{state.message}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PhaseDot({ status }: { status: 'pending' | 'active' | 'done' }) {
  if (status === 'done') {
    return (
      <span className="mt-1 inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden />
    );
  }
  if (status === 'active') {
    return (
      <span className="mt-1 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
    );
  }
  return (
    <span className="mt-1 inline-block h-2.5 w-2.5 rounded-full border border-zinc-300" aria-hidden />
  );
}

function UploadZone(props: {
  dragOver: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onClick: () => void;
  voice: string;
  setVoice: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={props.onClick}
        onDrop={props.onDrop}
        onDragOver={props.onDragOver}
        onDragLeave={props.onDragLeave}
        className={`block w-full rounded-2xl border-2 border-dashed p-12 text-center transition ${
          props.dragOver
            ? 'border-amber-400 bg-amber-50'
            : 'border-zinc-300 bg-white hover:border-zinc-400'
        }`}
      >
        <div className="mx-auto max-w-sm">
          <div className="text-base font-medium text-zinc-900">Drop a .pptx here</div>
          <div className="mt-1 text-sm text-zinc-500">or click to browse</div>
        </div>
      </button>
      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm">
        <label htmlFor="voice" className="text-zinc-600">Narrator voice</label>
        <select
          id="voice"
          value={props.voice}
          onChange={(e) => props.setVoice(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-900 outline-none focus:border-zinc-400"
        >
          {VOICES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Result({ result }: { result: DoneEvent }) {
  return (
    <div className="mt-6 space-y-3">
      <video
        src={result.out}
        controls
        className="w-full rounded-xl border border-zinc-200 bg-black"
      />
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <div>
          {formatDuration(result.video_duration)} · {(result.video_bytes / 1_000_000).toFixed(1)} MB
        </div>
        <div>
          Wall: {result.wall_clock.toFixed(1)}s · Cost: ${result.cost_usd.toFixed(4)}
        </div>
      </div>
      <a
        href={result.out}
        download
        className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800"
      >
        Download MP4
      </a>
    </div>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
