/**
 * Home-page data plumbing.
 *
 * The home page is a Server Component, so it talks to Drizzle directly rather
 * than going through `/api/projects`. This module owns that read path and
 * reuses `loadLatestRender` from `lib/api/serialize.ts` for the signed-URL
 * work — the only non-trivial join the home needs is "latest render → signed
 * URL" and that helper already does it.
 *
 * Returns two groups separated up-front so the Server Component can decide
 * which section headers to render without re-filtering.
 */

import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';

import { db, projects, type Project } from '@/lib/db';
import { loadLatestRender, serializeProject } from '@/lib/api/serialize';

export type HomeProjectRow = ReturnType<typeof serializeProject> & {
  latest_render?: Awaited<ReturnType<typeof loadLatestRender>>;
};

export type HomeData = {
  samples: HomeProjectRow[];
  userProjects: HomeProjectRow[];
};

/**
 * Load the home-page lists for `userId`.
 *
 * Samples = `is_sample=true` projects (any owner). Sorted alphabetically by
 *   name so the order is stable across users.
 * User projects = projects owned by `userId`, not soft-deleted, not samples.
 *   Sorted by `updated_at DESC` so the most-recently-touched project is on top.
 *
 * For samples (and any rendered project) we attach `latest_render` with a
 * signed MP4 URL — that powers the SampleModal.
 */
export async function listProjectsForHome(userId: string): Promise<HomeData> {
  const rows: Project[] = await db
    .select()
    .from(projects)
    .where(
      and(
        or(eq(projects.userId, userId), eq(projects.isSample, true)),
        isNull(projects.deletedAt),
      ),
    )
    // Samples first; within samples, alphabetical; user projects ordered
    // separately below by updated_at desc. We fetch in one query and split.
    .orderBy(desc(projects.isSample), asc(projects.name));

  const samplesRaw = rows.filter((p) => p.isSample);
  // Sort user projects by updatedAt desc explicitly (DB query above used name
  // for the samples branch — re-sort the owner branch here).
  const userProjectsRaw = rows
    .filter((p) => !p.isSample && p.userId === userId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const samples: HomeProjectRow[] = await Promise.all(
    samplesRaw.map(async (p) => {
      const base = serializeProject(p);
      const latest = await loadLatestRender(p.id);
      return latest ? { ...base, latest_render: latest } : base;
    }),
  );

  const userProjects: HomeProjectRow[] = await Promise.all(
    userProjectsRaw.map(async (p) => {
      const base = serializeProject(p);
      if (p.status === 'rendered') {
        const latest = await loadLatestRender(p.id);
        if (latest) return { ...base, latest_render: latest };
      }
      return base;
    }),
  );

  return { samples, userProjects };
}
