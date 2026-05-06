/**
 * PATCH /api/slides/[id]
 *
 * Auto-save endpoint. The editor PATCHes on debounced typing.
 *
 * Setting `script` flips `script_locked=true` so subsequent project-wide
 * regenerations don't blow away the user's manual edit. Per-slide regen
 * (POST /api/slides/[id]/regen) explicitly clears the lock.
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
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
import { getSlideWithProject } from '@/lib/api/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchBody = z
  .object({
    script: z.string().optional(),
    voice: z.string().min(1).max(64).optional(),
  })
  .refine((v) => v.script !== undefined || v.voice !== undefined, {
    message: 'Provide at least one of: script, voice',
  });

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
    const found = await getSlideWithProject(id, user.id);
    if (!found) return notFound();
    if (found.project.isSample) return forbidden('Samples are read-only');
    if (found.project.userId !== user.id) return notFound();

    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.script !== undefined) {
      setClause.script = parsed.data.script;
      // Manual edits lock the script from auto-regen.
      setClause.scriptLocked = true;
    }
    if (parsed.data.voice !== undefined) {
      setClause.voice = parsed.data.voice;
    }

    const rows = await db
      .update(slides)
      .set(setClause)
      .where(eq(slides.id, id))
      .returning();

    const s = rows[0];
    return NextResponse.json({
      slide: {
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
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
