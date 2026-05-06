/**
 * POST /api/renders
 *
 * Body: { project_id: string; voice?: string; captions?: boolean }
 *
 * Enqueue a `full_render` job. Worker:
 *   - reads slides for project
 *   - regenerates audio for any slide whose audio_path is null or whose
 *     script changed since the last render (worker-side decision, not ours)
 *   - encodes the MP4
 *   - writes a `renders` row + sets project.status='rendered'
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
import { getProjectForUser } from '@/lib/api/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  project_id: z.string().uuid(),
  voice: z.string().min(1).max(64).optional(),
  captions: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await getCurrentUser();
  } catch (e) {
    return unauthorized(e instanceof Error ? e.message : 'Unauthorized');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
  }

  try {
    const project = await getProjectForUser(parsed.data.project_id, user.id);
    if (!project) return notFound();
    if (project.isSample) return forbidden('Samples are read-only');
    if (project.userId !== user.id) return notFound();

    const payload: Record<string, unknown> = {};
    if (parsed.data.voice !== undefined) payload.voice = parsed.data.voice;
    if (parsed.data.captions !== undefined) payload.captions = parsed.data.captions;

    const jobId = uuidv7();
    await db.insert(renderJobs).values({
      id: jobId,
      projectId: project.id,
      kind: 'full_render',
      payload,
      status: 'queued',
    });

    return NextResponse.json({ job_id: jobId }, { status: 202 });
  } catch (e) {
    return serverError(e);
  }
}
