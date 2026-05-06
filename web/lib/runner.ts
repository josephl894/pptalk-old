import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';

export type RenderEvent =
  | { event: 'run_start'; run_id: string; pptx: string }
  | { event: 'phase_start'; phase: string; total?: number }
  | { event: 'phase_done'; phase: string; duration: number; [k: string]: unknown }
  | { event: 'slide_done'; phase: string; index: number; title?: string; preview?: string }
  | {
      event: 'done';
      run_id: string;
      out: string;
      wall_clock: number;
      cost_usd: number;
      video_duration: number;
      video_bytes: number;
    }
  | { event: 'error'; message: string };

const PIPELINE_DIR = path.resolve(process.cwd(), '..', 'pipeline');

export function spawnRender(pptxPath: string, outPath: string, voice = 'onyx') {
  const proc = spawn(
    'uv',
    ['run', 'narrator', pptxPath, '--out', outPath, '--voice', voice],
    { cwd: PIPELINE_DIR, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const events = (async function* (): AsyncGenerator<RenderEvent> {
    const rl = readline.createInterface({ input: proc.stderr });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        yield JSON.parse(trimmed) as RenderEvent;
      } catch {
        // Non-JSON lines from rich/python warnings — ignore
      }
    }
  })();

  const exitCode = new Promise<number>((resolve) => {
    proc.on('exit', (code) => resolve(code ?? 1));
  });

  return { events, exitCode, proc };
}
