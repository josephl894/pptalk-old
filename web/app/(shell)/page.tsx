/**
 * Home / projects page. Wave 1 design re-lock (2026-05-06):
 *   - 3-col card grid (replaced the Linear-row list)
 *   - Sidebar provides the only "+ New project" entry; the grid's first
 *     dashed tile and the empty-state CTA both route to /new
 *   - Samples render in their own section above the user's projects
 */

import { getCurrentUser } from '@/lib/auth';
import { listProjectsForHome, type HomeProjectRow } from '@/lib/home/queries';
import { NewProjectTile } from '@/components/home/NewProjectTile';
import { ProjectCard } from '@/components/home/ProjectCard';
import { SampleCard } from '@/components/home/SampleCard';
import { EmptyState } from '@/components/home/EmptyState';
import type { ProjectStatus } from '@/components/shell/StatusTag';
import { SearchIcon } from '@/components/shell/icons';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getCurrentUser();
  const { samples, userProjects } = await listProjectsForHome(user.id);

  return (
    <>
      <div className="pp-topbar">
        <div className="pp-crumbs">
          <span>Workspace</span>
          <span className="pp-sep">/</span>
          <span className="pp-here">My work</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex h-8 w-[220px] items-center gap-1.5 rounded-md border border-[color:var(--hairline-2)] px-2.5 text-[13px] text-[color:var(--ink-3)]">
            <SearchIcon size={14} />
            <span className="text-[color:var(--ink-4)]">Search projects</span>
            <span className="pp-kbd ml-auto">⌘K</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-10 py-8">
        <header className="mb-6 flex items-end justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="t-28">My work</h1>
            <div className="t-13 text-[color:var(--ink-3)]">
              {userProjects.length === 0
                ? 'No projects yet — start one from the sidebar.'
                : `${userProjects.length} project${userProjects.length === 1 ? '' : 's'} · sorted by last edited`}
            </div>
          </div>
        </header>

        {samples.length > 0 && (
          <section className="mb-8 flex flex-col gap-3">
            <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink-4)]">
              Samples
            </h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {samples.map((p) => (
                <SampleCard
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  status={p.status as ProjectStatus}
                  numSlides={p.num_slides}
                  updatedAt={asIso(p.updated_at)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink-4)]">
            Your projects
          </h2>
          {userProjects.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <NewProjectTile />
              {userProjects.map((p: HomeProjectRow) => (
                <ProjectCard
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  status={p.status as ProjectStatus}
                  numSlides={p.num_slides}
                  updatedAt={p.updated_at}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function asIso(d: Date | string): string {
  if (typeof d === 'string') return d;
  return d.toISOString();
}
