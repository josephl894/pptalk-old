import { StubPage } from '@/components/shell/StubPage';
import { VideosIcon } from '@/components/shell/icons';

export const dynamic = 'force-dynamic';

export default function VideosPage() {
  return (
    <StubPage
      here="My videos"
      title="My videos"
      blurb="A unified view of every render — in flight, ready, and failed. Lands next."
      Icon={VideosIcon}
    />
  );
}
