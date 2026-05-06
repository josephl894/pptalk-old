/**
 * Editor page (server component).
 *
 * Mirrors the wire shape of `GET /api/projects/[id]` so the client tree can
 * live entirely off `initialProject` / `initialSlides` / `initialActiveJobs`
 * / `initialLatestRender` and update via Realtime from there.
 *
 * Access rules (samples don't have an editor view):
 *   - missing / soft-deleted project → /
 *   - sample project → /
 *   - project owned by another user → /
 */

import { redirect } from 'next/navigation';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { getCurrentUser } from '@/lib/auth';
import { getProjectForUser } from '@/lib/api/projects';
import {
  db,
  renderJobs,
  slides,
  type Slide,
} from '@/lib/db';
import { getPublicSignedUrl } from '@/lib/storage';
import { loadLatestRender, serializeProject } from '@/lib/api/serialize';
import { EditorShell } from '@/components/editor/EditorShell';
import type {
  EditorActiveJob,
  EditorLatestRender,
  EditorProject,
  EditorSlide,
} from '@/components/editor/types';

export const dynamic = 'force-dynamic';

async function safeSignedUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    return await getPublicSignedUrl(path);
  } catch {
    return null;
  }
}

export default async function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();

  const project = await getProjectForUser(id, user.id);
  if (!project) redirect('/');
  if (project.isSample) redirect('/');
  if (project.userId !== user.id) redirect('/');

  const slideRows: Slide[] = await db
    .select()
    .from(slides)
    .where(and(eq(slides.projectId, id), isNull(slides.deletedAt)))
    .orderBy(asc(slides.idx));

  const initialSlides: EditorSlide[] = await Promise.all(
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
      png_signed_url: await safeSignedUrl(s.pngPath),
      audio_signed_url: await safeSignedUrl(s.audioPath),
    })),
  );

  const activeJobRows = await db
    .select()
    .from(renderJobs)
    .where(
      and(
        eq(renderJobs.projectId, id),
        inArray(renderJobs.status, ['queued', 'running']),
      ),
    );

  const initialActiveJobs: EditorActiveJob[] = activeJobRows.map((j) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    payload: j.payload,
    attempts: j.attempts,
    error: j.error,
    created_at: j.createdAt,
    updated_at: j.updatedAt,
  }));

  let initialLatestRender: EditorLatestRender = null;
  if (project.status === 'rendered') {
    initialLatestRender = await loadLatestRender(project.id);
  }

  const serialized = serializeProject(project);
  const initialProject: EditorProject = {
    ...serialized,
    // serializeProject types source_kind as `string`; the projects table only
    // ever stores 'pptx' or 'pdf', enforced at upload time.
    source_kind: serialized.source_kind as 'pptx' | 'pdf',
  };

  return (
    <EditorShell
      initialProject={initialProject}
      initialSlides={initialSlides}
      initialActiveJobs={initialActiveJobs}
      initialLatestRender={initialLatestRender}
    />
  );
}
