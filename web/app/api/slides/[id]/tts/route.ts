/**
 * POST /api/slides/[id]/tts
 *
 * Enqueue a per-slide TTS regeneration. Worker reads the current
 * `slides.script` and writes a fresh MP3 to storage + updates audio_path /
 * audio_duration_s.
 *
 * Voice precedence (when not provided in body): slide.voice → 'alloy'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth';
import { db, renderJobs } from '@/lib/db';
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/errors';
import { getSlideWithProject } from '@/lib/api/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    voice: z.string().min(1).max(64).optional(),
  })
  .optional();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let user;
  try {
    user = await getCurrentUser();
  } catch (e) {
    return unauthorized(e instanceof Error ? e.message : 'Unauthorized');
  }

  // Body is optional; default to {}.
  let parsedBody: { voice?: string } = {};
  const text = await req.text();
  if (text.trim().length > 0) {
    try {
      const json = JSON.parse(text);
      const parsed = Body.safeParse(json);
      if (!parsed.success) {
        return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
      }
      parsedBody = parsed.data ?? {};
    } catch {
      return badRequest('Invalid JSON body');
    }
  }

  try {
    const found = await getSlideWithProject(id, user.id);
    if (!found) return notFound();
    if (found.project.isSample) return forbidden('Samples are read-only');
    if (found.project.userId !== user.id) return notFound();

    const voice = parsedBody.voice ?? found.slide.voice ?? 'alloy';

    const jobId = uuidv7();
    await db.insert(renderJobs).values({
      id: jobId,
      projectId: found.project.id,
      kind: 'slide_tts',
      payload: { slide_id: id, voice },
      status: 'queued',
    });

    return NextResponse.json({ job_id: jobId }, { status: 202 });
  } catch (e) {
    return serverError(e);
  }
}
