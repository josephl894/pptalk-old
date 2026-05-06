import { NextRequest } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawnRender, RenderEvent } from '@/lib/runner';

export const runtime = 'nodejs';
export const maxDuration = 600;
export const dynamic = 'force-dynamic';

const RENDERS_DIR = path.join(process.cwd(), 'public', 'renders');
const UPLOADS_DIR = path.join('/tmp', 'pptalk-uploads');

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file');
  const voice = (formData.get('voice') as string | null) ?? 'onyx';

  if (!file || !(file instanceof File)) {
    return new Response('Missing file', { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.pptx')) {
    return new Response('Only .pptx accepted in v0.5', { status: 400 });
  }

  const jobId = randomUUID();
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(RENDERS_DIR, { recursive: true });

  const pptxPath = path.join(UPLOADS_DIR, `${jobId}.pptx`);
  const outPath = path.join(RENDERS_DIR, `${jobId}.mp4`);

  await writeFile(pptxPath, Buffer.from(await file.arrayBuffer()));

  const { events, exitCode } = spawnRender(pptxPath, outPath, voice);

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, evt: RenderEvent) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const evt of events) {
          if (evt.event === 'done') {
            send(controller, {
              ...evt,
              out: `/renders/${jobId}.mp4`,
            });
          } else {
            send(controller, evt);
          }
        }
        const code = await exitCode;
        if (code !== 0) {
          send(controller, { event: 'error', message: `pipeline exited ${code}` });
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        send(controller, { event: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
