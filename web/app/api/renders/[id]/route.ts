/**
 * GET /api/renders/[id]
 *
 * Returns a single render row + signed URLs for mp4 and srt (if any).
 * Ownership verified via the render's project.
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { getCurrentUser } from '@/lib/auth';
import { db, renders } from '@/lib/db';
import { signedUrl } from '@/lib/storage';
import {
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/errors';
import { getProjectForUser } from '@/lib/api/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
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
    const rows = await db.select().from(renders).where(eq(renders.id, id)).limit(1);
    const render = rows[0];
    if (!render) return notFound();

    const project = await getProjectForUser(render.projectId, user.id);
    if (!project) return notFound();

    let mp4 = '';
    try {
      mp4 = await signedUrl(render.mp4Path);
    } catch {
      mp4 = '';
    }
    let srt: string | null = null;
    if (render.srtPath) {
      try {
        srt = await signedUrl(render.srtPath);
      } catch {
        srt = null;
      }
    }

    return NextResponse.json({
      render: {
        id: render.id,
        project_id: render.projectId,
        mp4_signed_url: mp4,
        srt_signed_url: srt,
        captions: render.captions,
        video_duration_s: render.videoDurationS,
        video_bytes: render.videoBytes,
        cost_usd: render.costUsd,
        created_at: render.createdAt,
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
