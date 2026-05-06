'use client';

/**
 * Read-only sample-watch modal. Mounted once by <CmdKProvider> and opened
 * imperatively via `useCmdK().openSample(sampleId)`. We accept just the
 * sampleId from context and fetch the project + latest render details on
 * open so the palette/home-row don't have to hand the signed URL around.
 *
 * On close we pause the <video> and clear its src to stop audio playback.
 */

import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type SampleData = {
  name: string;
  mp4Url: string;
  aspectW: number;
  aspectH: number;
};

export function SampleModal({
  sampleId,
  onClose,
}: {
  sampleId: string | null;
  onClose: () => void;
}) {
  const open = sampleId !== null;
  const [data, setData] = React.useState<SampleData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  // Fetch sample details when a new sampleId comes in. We don't cache across
  // openings because signed URLs expire — better to re-mint each time.
  React.useEffect(() => {
    if (!sampleId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/projects/${sampleId}`, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`Failed to load sample (${res.status})`);
        }
        const body = (await res.json()) as {
          name: string;
          aspect_w: number | null;
          aspect_h: number | null;
          latest_render?: { mp4_signed_url: string };
        };
        if (cancelled) return;
        if (!body.latest_render?.mp4_signed_url) {
          setError('Sample video is not available yet.');
          setData(null);
        } else {
          setData({
            name: body.name,
            mp4Url: body.latest_render.mp4_signed_url,
            aspectW: body.aspect_w ?? 16,
            aspectH: body.aspect_h ?? 9,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load sample');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sampleId]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Stop playback before unmounting the <video>. Clearing src and calling
      // load() releases the audio decoder so the modal closing actually
      // silences the room.
      const v = videoRef.current;
      if (v) {
        try {
          v.pause();
          v.removeAttribute('src');
          v.load();
        } catch {
          // best-effort
        }
      }
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{data?.name ?? (loading ? 'Loading…' : 'Sample')}</DialogTitle>
        </DialogHeader>

        <div
          className="w-full overflow-hidden rounded-md bg-black"
          style={{ aspectRatio: `${data?.aspectW ?? 16}/${data?.aspectH ?? 9}` }}
        >
          {data ? (
            <video
              ref={videoRef}
              controls
              src={data.mp4Url}
              className="h-full w-full"
              preload="metadata"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
              {error ?? (loading ? 'Loading…' : '')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
