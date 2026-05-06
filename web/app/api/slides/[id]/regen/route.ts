/**
 * POST /api/slides/[id]/regen
 *
 * Enqueue a `slide_script_regen` job for one slide. Worker re-runs the script
 * generator from the slide image and overwrites `slides.script`.
 *
 * Design call: regenerating clears `script_locked`. The implicit user intent
 * is "give me a new script for this slide" — keeping the lock would mean the
 * worker had to either skip the regen (silent no-op, confusing) or fight it.
 * Clearing the lock is consistent with "manual edit locks; manual regen
 * unlocks."
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';

import { getCurrentUser } from '@/lib/auth';
import { db, renderJobs, slides } from '@/lib/db';
import {
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/errors';
import { getSlideWithProject } from '@/lib/api/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let user;
  try {
    user = await getCurrentUser();
  } catch (e) {
    return unauthorized(e instanceof Error ? e.message : 'Unauthorized');
  }

  try {
    const found = await getSlideWithProject(id, user.id);
    if (!found) return notFound();
    if (found.project.isSample) return forbidden('Samples are read-only');
    if (found.project.userId !== user.id) return notFound();

    const jobId = uuidv7();
    await db.insert(renderJobs).values({
      id: jobId,
      projectId: found.project.id,
      kind: 'slide_script_regen',
      payload: { slide_id: id },
      status: 'queued',
    });

    // Clear the lock so the worker can overwrite the script.
    await db
      .update(slides)
      .set({ scriptLocked: false, updatedAt: new Date() })
      .where(eq(slides.id, id));

    return NextResponse.json({ job_id: jobId }, { status: 202 });
  } catch (e) {
    return serverError(e);
  }
}
