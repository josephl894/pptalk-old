/**
 * Shared types between the server page (`app/p/[id]/page.tsx`) and the
 * client `<EditorShell>` tree.
 *
 * Mirrors the wire shape of `GET /api/projects/[id]` so the same components
 * can later be fed by a client-side fetch if we ever switch to it. The
 * server page constructs these values directly.
 */

export type EditorSlide = {
  id: string;
  idx: number;
  original_idx: number;
  title: string | null;
  body_text: string | null;
  speaker_notes: string | null;
  script: string | null;
  script_locked: boolean;
  voice: string | null;
  audio_duration_s: number | null;
  png_signed_url: string | null;
  audio_signed_url: string | null;
};

export type EditorActiveJob = {
  id: string;
  kind: string;
  status: string;
  payload: unknown;
  attempts: number;
  error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type EditorLatestRender = {
  id: string;
  mp4_signed_url: string;
  srt_signed_url: string | null;
  captions: boolean;
  video_duration_s: number | null;
  video_bytes: number | null;
  created_at: string | Date;
} | null;

export type EditorProject = {
  id: string;
  name: string;
  source_kind: 'pptx' | 'pdf';
  num_slides: number;
  status: string;
  is_sample: boolean;
  aspect_w: number | null;
  aspect_h: number | null;
};
