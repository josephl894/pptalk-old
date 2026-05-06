/**
 * Layout for routes that share the persistent sidebar shell:
 *   - `/` (home / projects grid)
 *   - `/new` (full-page upload)
 *   - `/videos`, `/voices`, `/trash` (Wave 1 stubs)
 *
 * The editor at `/p/[id]` stays outside this group so it can use its own
 * full-bleed chrome.
 */

import { getCurrentUser } from '@/lib/auth';
import { listProjectsForHome } from '@/lib/home/queries';
import { AppShell } from '@/components/shell/AppShell';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // Sidebar shows the same Samples list the home page does. We re-use the
  // existing query rather than introducing a new one.
  let samples: { id: string; name: string }[] = [];
  try {
    const user = await getCurrentUser();
    const data = await listProjectsForHome(user.id);
    samples = data.samples.map((s) => ({ id: s.id, name: s.name }));
  } catch {
    // Best-effort. If auth/db fails the sidebar still renders without samples.
  }

  return <AppShell samples={samples}>{children}</AppShell>;
}
