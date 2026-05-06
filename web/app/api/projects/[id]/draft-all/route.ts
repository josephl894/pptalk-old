/**
 * POST /api/projects/[id]/draft-all
 *
 * Enqueue `slide_script_regen` jobs for every slide in this project where the
 * script is empty/null and the slide isn't locked. Each slide gets its own
 * worker job so per-slide progress is observable via realtime, and existing
 * worker code paths are reused unchanged (no new job kind).
 *
 * Returns the list of job ids created and the slide ids they target. Caller
 * uses realtime on `slides` to drive per-slide progress, and on `render_jobs`
 * for queued/done state.
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

    const jobs = targetSlides.map((s) => ({
      id: uuidv7(),
      projectId: project.id,
      kind: 'slide_script_regen' as const,
      payload: { slide_id: s.id },
      status: 'queued' as const,
    }));

    // Single transaction: insert all jobs + bump updated_at on the targeted
    // slides so realtime fires for clients showing the overview.
    await db.transaction(async (tx) => {
      await tx.insert(renderJobs).values(jobs);
      await tx
        .update(slides)
        .set({ updatedAt: new Date() })
        .where(
          inArray(
            slides.id,
            targetSlides.map((s) => s.id),
          ),
        );
    });

    return NextResponse.json(
      {
        job_ids: jobs.map((j) => j.id),
        slide_ids: targetSlides.map((s) => s.id),
      },
      { status: 202 },
    );
  } catch (e) {
    return serverError(e);
  }
}
