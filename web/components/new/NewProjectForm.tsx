'use client';

/**
 * Full-page upload form for /new (Wave 1). Mirrors the deck → film
 * illustration from the Hi-Fi mockup, plus a dashed drop zone and the
 * Browse-files / Start-blank CTA pair.
 *
 * Upload + parse-poll behaviour is identical to the previous
 * NewProjectDialog — we POST to /api/projects, then poll the project's
 * status until ready / failed / timeout, then route to the editor.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { PlayIcon } from '@/components/shell/icons';

type Stage = 'idle' | 'uploading' | 'parsing';

const ACCEPT = '.pptx,.pdf';
const PARSE_POLL_MS = 1500;
const PARSE_TIMEOUT_MS = 90_000;

function basenameNoExt(name: string): string {
  return name.replace(/\.(pptx|pdf)$/i, '').trim();
}

export function NewProjectForm() {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [stage, setStage] = React.useState<Stage>('idle');
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  function handleFileChosen(f: File) {
    const lower = f.name.toLowerCase();
    if (!lower.endsWith('.pptx') && !lower.endsWith('.pdf')) {
      toast.error('Only .pptx and .pdf are supported.');
      return;
    }
    setFile(f);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileChosen(f);
  }

  async function pollUntilReady(projectId: string): Promise<void> {
    const deadline = Date.now() + PARSE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`/api/projects/${projectId}`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { status?: string };
          if (data.status === 'ready' || data.status === 'rendered' || data.status === 'failed') {
            return;
          }
        }
      } catch {
        // transient — keep polling
      }
      await new Promise((r) => setTimeout(r, PARSE_POLL_MS));
    }
  }

  async function startUpload(uploadFile: File) {
    setStage('uploading');
    const fd = new FormData();
    fd.append('file', uploadFile);
    fd.append('name', basenameNoExt(uploadFile.name));

    let projectId: string;
    try {
      const res = await fetch('/api/projects', { method: 'POST', body: fd });
      if (!res.ok) {
        let message = `Upload failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // non-JSON
        }
        toast.error(message);
        setStage('idle');
        return;
      }
      const body = (await res.json()) as { project: { id: string } };
      projectId = body.project.id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
      setStage('idle');
      return;
    }

    setStage('parsing');
    await pollUntilReady(projectId);
    router.push(`/p/${projectId}`);
  }

  React.useEffect(() => {
    if (file && stage === 'idle') {
      void startUpload(file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const busy = stage !== 'idle';
  const statusLabel =
    stage === 'uploading' ? 'Uploading deck…' : stage === 'parsing' ? 'Parsing slides…' : '';

  return (
    <div className="flex w-full max-w-[560px] flex-col items-center gap-6 text-center">
      <Illustration />
      <div className="flex flex-col gap-2">
        <h1 className="t-28">Turn slides into spoken video</h1>
        <p className="t-14 text-[color:var(--ink-3)]">
          Drop in a PowerPoint or PDF. We&rsquo;ll lay out slides as a script you can edit, then narrate it.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileChosen(f);
          e.target.value = '';
        }}
      />

      <div
        className="flex w-full flex-col items-center gap-3 rounded-[10px] border-[1.5px] border-dashed bg-[color:var(--paper-2)] px-7 py-8 transition-colors duration-150 ease-out"
        style={{
          borderColor: dragOver ? 'var(--accent)' : 'var(--hairline-2)',
          background: dragOver ? 'var(--accent-tint)' : 'var(--paper-2)',
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--accent-tint)] text-[color:var(--accent-2)]">
          <UploadCloud />
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="t-14 font-medium">
            {file ? file.name : 'Drop your deck here'}
          </div>
          <div className="t-12 text-[color:var(--ink-3)]">.pptx · .pdf · up to 100 slides</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[color:var(--accent)] px-3.5 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(180,60,40,0.18),inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors duration-150 ease-out hover:bg-[color:var(--accent-2)] disabled:opacity-60"
          >
            Browse files
          </button>
        </div>
      </div>

      {busy && (
        <div className="flex w-full flex-col gap-1.5">
          <div className="pp-bar">
            <div className="pp-fill animate-pulse" style={{ width: '40%' }} />
          </div>
          <span className="t-12 text-[color:var(--ink-3)]">{statusLabel}</span>
        </div>
      )}
    </div>
  );
}

function Illustration() {
  // Deck → coral arrow → dark-ink video tile + waveform. Mirrors the Hi-Fi
  // empty-state illustration but kept compact.
  return (
    <div className="relative" style={{ width: 240, height: 132 }}>
      {/* paper slide */}
      <div
        className="absolute flex flex-col gap-1 rounded-md border bg-[color:var(--paper)] p-2.5"
        style={{
          left: 0,
          top: 14,
          width: 96,
          height: 64,
          borderColor: 'var(--hairline-2)',
          boxShadow: 'var(--shadow-sm)',
          transform: 'rotate(-4deg)',
        }}
      >
        <div className="rounded-[2px]" style={{ height: 5, width: '70%', background: 'var(--ink-1)' }} />
        <div className="rounded-[2px]" style={{ height: 3, width: '90%', background: 'var(--ink-5)' }} />
        <div className="rounded-[2px]" style={{ height: 3, width: '60%', background: 'var(--ink-5)' }} />
        <div className="mt-auto rounded-[2px]" style={{ height: 3, width: '80%', background: 'var(--ink-5)' }} />
      </div>
      {/* coral arrow */}
      <svg
        className="absolute"
        style={{ left: 92, top: 38, width: 56, height: 48 }}
        viewBox="0 0 56 48"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 24 C 18 8, 38 8, 50 24" />
        <path d="m44 18 6 6-6 6" />
      </svg>
      {/* video tile */}
      <div
        className="absolute flex items-center justify-center rounded-md"
        style={{
          right: 0,
          top: 30,
          width: 110,
          height: 70,
          background: 'var(--ink-1)',
          boxShadow: 'var(--shadow)',
          transform: 'rotate(3deg)',
        }}
      >
        <div className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--accent)] text-white">
          <PlayIcon size={12} />
        </div>
      </div>
      {/* waveform */}
      <div
        className="absolute flex items-center gap-[2px]"
        style={{ right: 8, top: 104, transform: 'rotate(3deg)' }}
      >
        {[3, 6, 10, 5, 8, 12, 7, 9, 4, 7, 11, 6, 8].map((h, i) => (
          <div
            key={i}
            style={{ width: 2, height: h, background: 'var(--ink-5)', borderRadius: 1 }}
          />
        ))}
      </div>
    </div>
  );
}

function UploadCloud() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 11V3" />
      <path d="m5 6 3-3 3 3" />
      <path d="M3 13.5h10" />
    </svg>
  );
}
