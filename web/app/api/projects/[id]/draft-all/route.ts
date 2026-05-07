/**
 * POST /api/projects/[id]/draft-all
 *
 * Enqueue ONE `project_script_regen` job that batches every empty, unlocked,
 * non-deleted slide into a single Claude call (collapsing what used to be N
 * sequential `slide_script_regen` jobs). The worker writes each slide's
 * script in a single transaction so per-slide realtime still fires for the
 * overview overlay's progress display.
 *
 * Returns `{job_ids, slide_ids}`. `job_ids` is one id (the batched job) when
 * any slides are in scope, or empty when nothing needs drafting. `slide_ids`
 * lists the slides the worker will operate on.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';

import { getCurrentUser } from '@/lib/auth';
import { db, renderJobs, slides } from '@/lib/db';
import {
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/errors';
import { getProjectForUser } from '@/lib/api/projects';

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
    const project = await getProjectForUser(id, user.id);
    if (!project) return notFound();
    if (project.isSample) return forbidden('Samples are read-only');
    if (project.userId !== user.id) return notFound();

    // Pick slides where script is empty and not locked.
    const targetSlides = await db
      .select({ id: slides.id })
      .from(slides)
      .where(
        and(
          eq(slides.projectId, project.id),
          isNull(slides.deletedAt),
          eq(slides.scriptLocked, false),
          or(isNull(slides.script), eq(slides.script, '')),
        ),
      );

    if (targetSlides.length === 0) {
      return NextResponse.json({ job_ids: [], slide_ids: [] }, { status: 200 });
    }

    const slideIds = targetSlides.map((s) => s.id);
    const job = {
      id: uuidv7(),
      projectId: project.id,
      kind: 'project_script_regen' as const,
      payload: { slide_ids: slideIds },
      status: 'queued' as const,
    };

    // Single transaction: insert the batched job + bump updated_at on the
    // targeted slides so the overview overlay's realtime subscription fires
    // for the initial "drafting" state. The per-slide-completion fan-out
    // happens later when the worker writes scripts (one UPDATE per slide).
    await db.transaction(async (tx) => {
      await tx.insert(renderJobs).values(job);
      await tx
        .update(slides)
        .set({ updatedAt: new Date() })
        .where(inArray(slides.id, slideIds));
    });

    return NextResponse.json(
      {
        job_ids: [job.id],
        slide_ids: slideIds,
      },
      { status: 202 },
    );
  } catch (e) {
    return serverError(e);
  }
}
