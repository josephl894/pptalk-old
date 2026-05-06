import { StubPage } from '@/components/shell/StubPage';
import { VoiceIcon } from '@/components/shell/icons';

export const dynamic = 'force-dynamic';

export default function VoicesPage() {
  return (
    <StubPage
      here="Voice library"
      title="Voice library"
      blurb="Browse and preview the six locked OpenAI voices. Lands next."
      Icon={VoiceIcon}
    />
  );
}
