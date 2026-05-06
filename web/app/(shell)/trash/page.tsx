import { StubPage } from '@/components/shell/StubPage';
import { TrashIcon } from '@/components/shell/icons';

export const dynamic = 'force-dynamic';

export default function TrashPage() {
  return (
    <StubPage
      here="Recycle bin"
      title="Recycle bin"
      blurb="Soft-deleted projects live here for 30 days. Lands with the editor surface."
      Icon={TrashIcon}
    />
  );
}
