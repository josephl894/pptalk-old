/**
 * POST /api/slides/reorder
 *
 * Body: { project_id: string; ordered_slide_ids: string[] }
 *
 * Updates `slides.idx` to match the position of each slide in
 * `ordered_slide_ids` (0-indexed).
 *
 * Tricky: there's a UNIQUE(project_id, idx) constraint. A naive
 * `UPDATE ... SET idx = N` will collide mid-transaction if two slides swap
 * indices. Two-pass workaround:
 *   1. First, bump every slide's idx by `1_000_000` (out of normal range).
 *   2. Then set each slide's idx to its target position.
 *
 * Both passes happen inside a single transaction.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth';
import { db, slides } from '@/lib/db';
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
  ordered_slide_ids: z.array(z.string().uuid()).min(1),
});

const SHIFT = 1_000_000;

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

  const { project_id, ordered_slide_ids } = parsed.data;

  // Reject duplicates in the input list.
  const seen = new Set<string>();
  for (const sid of ordered_slide_ids) {
    if (seen.has(sid)) return badRequest('Duplicate slide_id in ordered list');
    seen.add(sid);
  }

  try {
    const project = await getProjectForUser(project_id, user.id);
    if (!project) return notFound();
    if (project.isSample) return forbidden('Samples are read-only');
    if (project.userId !== user.id) return notFound();

    // Validate every slide_id belongs to this project (and isn't soft-deleted).
    const existing = await db
      .select()
      .from(slides)
      .where(
        and(
          eq(slides.projectId, project_id),
          isNull(slides.deletedAt),
          inArray(slides.id, ordered_slide_ids),
        ),
      );
    if (existing.length !== ordered_slide_ids.length) {
      return badRequest(
        'Some slide_ids are not part of this project (or are soft-deleted)',
      );
    }

    await db.transaction(async (tx) => {
      // Pass 1: shift every supplied slide out of the normal range to avoid
      // UNIQUE collisions during pass 2.
      await tx
        .update(slides)
        .set({ idx: sql`${slides.idx} + ${SHIFT}`, updatedAt: new Date() })
        .where(
          and(
            eq(slides.projectId, project_id),
            inArray(slides.id, ordered_slide_ids),
          ),
        );

      // Pass 2: assign each slide its target idx.
      for (let i = 0; i < ordered_slide_ids.length; i++) {
        const sid = ordered_slide_ids[i];
        await tx
          .update(slides)
          .set({ idx: i, updatedAt: new Date() })
          .where(eq(slides.id, sid));
      }
    });

    const updated = await db
      .select()
      .from(slides)
      .where(
        and(
          eq(slides.projectId, project_id),
          isNull(slides.deletedAt),
        ),
      )
      .orderBy(slides.idx);

    return NextResponse.json({
      slides: updated.map((s) => ({
        id: s.id,
        idx: s.idx,
        original_idx: s.originalIdx,
        title: s.title,
      })),
    });
  } catch (e) {
    return serverError(e);
  }
}
