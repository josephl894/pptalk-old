/**
 * Shared response serialization helpers for project / render rows.
 *
 * Lives outside `app/api/**` because Next.js route files may only export
 * specific reserved names (HTTP verbs, `runtime`, `dynamic`, etc.). Helpers
 * imported by sibling routes need to live in `lib/`.
 */

import { desc, eq } from 'drizzle-orm';

import {
  db,
  renders,
  type Project,
  type Render,
} from '@/lib/db';
import { signedUrl } from '@/lib/storage';

export function serializeProject(p: Project) {
  return {
    id: p.id,
    name: p.name,
    source_kind: p.sourceKind,
    num_slides: p.numSlides,
    status: p.status,
    is_sample: p.isSample,
    aspect_w: p.aspectW,
    aspect_h: p.aspectH,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export async function loadLatestRender(projectId: string) {
  const rows = await db
    .select()
    .from(renders)
    .where(eq(renders.projectId, projectId))
    .orderBy(desc(renders.createdAt))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return serializeRender(r);
}

export async function serializeRender(r: Render): Promise<{
  id: string;
  mp4_signed_url: string;
  srt_signed_url: string | null;
  captions: boolean;
  video_duration_s: number | null;
  video_bytes: number | null;
  created_at: Date;
}> {
  let mp4 = '';
  try {
    mp4 = await signedUrl(r.mp4Path);
  } catch {
    mp4 = '';
  }
  let srt: string | null = null;
  if (r.srtPath) {
    try {
      srt = await signedUrl(r.srtPath);
    } catch {
      srt = null;
    }
  }
  return {
    id: r.id,
    mp4_signed_url: mp4,
    srt_signed_url: srt,
    captions: r.captions,
    video_duration_s: r.videoDurationS,
    video_bytes: r.videoBytes,
    created_at: r.createdAt,
  };
}
