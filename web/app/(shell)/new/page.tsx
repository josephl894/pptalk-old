/**
 * /new — dedicated full-page upload surface (Wave 1; replaces the dialog).
 * Server component shell + client form (so we can stream the parse status).
 */

import { NewProjectForm } from '@/components/new/NewProjectForm';

export const dynamic = 'force-dynamic';

export default function NewProjectPage() {
  return (
    <>
      <div className="pp-topbar">
        <div className="pp-crumbs">
          <span>Workspace</span>
          <span className="pp-sep">/</span>
          <span className="pp-here">New project</span>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-10 py-6">
        <NewProjectForm />
      </div>
    </>
  );
}
