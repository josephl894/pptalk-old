/**
 * Internal helpers used by API routes for ownership checks and joined reads.
 *
 * Ownership rule:
 *   - A project is accessible if `user_id = currentUser.id` OR `is_sample=true`.
 *   - Samples are READ-ONLY: PATCH/POST handlers must reject when the loaded
 *     project's `is_sample` is true. Use `assertProjectWritable` for that.
 */

import { and, eq } from 'drizzle-orm';

import {
  db,
  projects,
  slides,
  type Project,
  type Slide,
} from '@/lib/db';

// RFC 4122 variants 1-5 (and the v7 extension). The schema uses uuidv7 IDs;
// any input that isn't UUID-shaped is guaranteed not to match a row, and
// passing it raw to Postgres throws `invalid input syntax for type uuid`
// (surfaces as a 500). Validate up front and treat malformed IDs as not-found.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export async function getProjectForUser(
  projectId: string,
  userId: string,
): Promise<Project | null> {
  if (!isUuid(projectId)) return null;
  const rows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const project = rows[0];
  if (!project) return null;
  if (project.deletedAt) return null;
  // Accessible if owned OR is a public sample.
  if (project.userId !== userId && !project.isSample) return null;
  return project;
}

export async function getSlideWithProject(
  slideId: string,
  userId: string,
): Promise<{ slide: Slide; project: Project } | null> {
  if (!isUuid(slideId)) return null;
  const rows = await db.select().from(slides).where(eq(slides.id, slideId)).limit(1);
  const slide = rows[0];
  if (!slide) return null;
  if (slide.deletedAt) return null;
  const project = await getProjectForUser(slide.projectId, userId);
  if (!project) return null;
  return { slide, project };
}

export async function getProjectSlides(projectId: string): Promise<Slide[]> {
  return db
    .select()
    .from(slides)
    .where(and(eq(slides.projectId, projectId)))
    .orderBy(slides.idx);
}
