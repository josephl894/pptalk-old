import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { CmdKProvider } from '@/components/cmdk/CmdKProvider';
import { getCurrentUser } from '@/lib/auth';
import { listProjectsForHome } from '@/lib/home/queries';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'PPTalk — Narrated video from your slide deck',
  description: 'Upload a PPTX or PDF and get a polished, narrated video.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Pre-fetch projects/samples server-side so the cmd+k palette can render
  // entries on first paint without a client-side fetch round-trip. This is
  // the same data the home page reads — safe to share since it's already
  // scoped to the current user.
  let palette: { samples: { id: string; name: string }[]; projects: { id: string; name: string }[] } = {
    samples: [],
    projects: [],
  };
  try {
    const user = await getCurrentUser();
    const { samples, userProjects } = await listProjectsForHome(user.id);
    palette = {
      samples: samples.map((s) => ({ id: s.id, name: s.name })),
      projects: userProjects.map((p) => ({ id: p.id, name: p.name })),
    };
  } catch {
    // Best-effort. If auth/db fails here, the palette renders empty; the
    // page itself will surface the underlying error.
  }

  return (
    <html lang="en" className={cn(inter.variable, jetbrainsMono.variable)}>
      <body className="min-h-screen font-sans">
        <CmdKProvider samples={palette.samples} projects={palette.projects}>
          {children}
        </CmdKProvider>
        <Toaster />
      </body>
    </html>
  );
}
