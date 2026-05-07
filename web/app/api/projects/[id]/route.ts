/**
 * /api/projects/[id]
 *
 * GET:   project + slides + signed URLs + active jobs + latest render.
 * PATCH: rename or soft-delete (samples are read-only → 403).
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth';
import {
  db,
  projects,
  renderJobs,
  slides,
  type Slide,
} from '@/lib/db';
import { getPublicSignedUrl } from '@/lib/storage';
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/errors';
import { getProjectForUser } from '@/lib/api/projects';
import {
  loadLatestRender,
  serializeProject,
} from '@/lib/api/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/projects/[id]
// ---------------------------------------------------------------------------

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
    const project = await getProjectForUser(id, user.id);
    if (!project) return notFound();

    const slideRows: Slide[] = await db
      .select()
      .from(slides)
      .where(and(eq(slides.projectId, id), isNull(slides.deletedAt)))
      .orderBy(slides.idx);

    const slidesOut = await Promise.all(
      slideRows.map(async (s) => ({
        id: s.id,
        idx: s.idx,
        original_idx: s.originalIdx,
        title: s.title,
        body_text: s.bodyText,
        speaker_notes: s.speakerNotes,
        script: s.script,
        script_locked: s.scriptLocked,
        voice: s.voice,
        audio_duration_s: s.audioDurationS,
        png_signed_url: s.pngPath ? await signedUrlSafe(s.pngPath) : null,
        audio_signed_url: s.audioPath ? await signedUrlSafe(s.audioPath) : null,
      })),
    );

    const activeJobs = await db
      .select()
      .from(renderJobs)
      .where(
        and(
          eq(renderJobs.projectId, id),
          inArray(renderJobs.status, ['queued', 'running']),
        ),
      );

    const base = {
      ...serializeProject(project),
      slides: slidesOut,
      active_jobs: activeJobs.map((j) => ({
        id: j.id,
        kind: j.kind,
        status: j.status,
        payload: j.payload,
        attempts: j.attempts,
        error: j.error,
        created_at: j.createdAt,
        updated_at: j.updatedAt,
      })),
    } as Record<string, unknown>;

    if (project.status === 'rendered') {
      const latest = await loadLatestRender(project.id);
      if (latest) base.latest_render = latest;
    }

    return NextResponse.json(base);
  } catch (e) {
    return serverError(e);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/projects/[id]
// ---------------------------------------------------------------------------

// Project-wide voice. Stored on each `slides` row (no `projects.voice` column);
// every slide gets the same value because per-slide voice override is out of
// scope per Wave 2 lock.
const VOICE_CODENAMES = ['onyx', 'echo', 'fable', 'shimmer', 'nova', 'alloy'] as const;

const PatchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    voice: z.enum(VOICE_CODENAMES).optional(),
    deleted: z.literal(true).optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.voice !== undefined || v.deleted === true,
    { message: 'Provide at least one of: name, voice, deleted' },
  );

export async function PATCH(
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
  }

  try {
    const project = await getProjectForUser(id, user.id);
    if (!project) return notFound();
    if (project.isSample) return forbidden('Samples are read-only');
    // Even though getProjectForUser allows samples, only owner can edit a
    // non-sample project (samples already rejected above).
    if (project.userId !== user.id) return notFound();

    if (parsed.data.deleted === true) {
      await db
        .update(projects)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(projects.id, id));
      return new NextResponse(null, { status: 204 });
    }

    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) setClause.name = parsed.data.name;

    // Wrap the voice + project update in a transaction so we never leave the
    // DB half-applied (slides updated, project bump dropped, or vice versa).
    const updated = await db.transaction(async (tx) => {
      if (parsed.data.voice !== undefined) {
        // Bulk-write voice to every non-deleted slide so a reload (which
        // derives the editor's initial voice from `slides.voice`) gets the
        // latest pick.
        await tx
          .update(slides)
          .set({ voice: parsed.data.voice, updatedAt: new Date() })
          .where(and(eq(slides.projectId, id), isNull(slides.deletedAt)));
      }
      return tx
        .update(projects)
        .set(setClause)
        .where(eq(projects.id, id))
        .returning();
    });

    return NextResponse.json({ project: serializeProject(updated[0]) });
  } catch (e) {
    return serverError(e);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 24h-expiry signed URL, swallowing errors. Used for slide PNG and audio
 * paths surfaced to the editor — long sessions need to outlive the 1h
 * default. The MP4 link in `latest_render` keeps the 1h default since
 * renders are short-lived and the export modal will refresh on its own.
 */
async function signedUrlSafe(path: string): Promise<string | null> {
  try {
    return await getPublicSignedUrl(path);
  } catch {
    return null;
  }
}
