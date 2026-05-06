/**
 * Storage path helpers + thin wrappers around Supabase Storage.
 *
 * Bucket: `pptalk-private` (private; access via signed URLs only).
 *
 * Path layout (mirrors pipeline/narrator/storage.py — keep these in sync):
 *     {user_id}/{project_id}/source/deck.{pptx|pdf}
 *     {user_id}/{project_id}/slides/{NNN}.png
 *     {user_id}/{project_id}/audio/{NNN}.mp3
 *     {user_id}/{project_id}/renders/{render_id}.mp4
 *     {user_id}/{project_id}/renders/{render_id}.srt
 *
 * The Python worker writes most of these via service-role; the web app
 * primarily uploads source decks and reads everything via signed URLs.
 *
 * Server-only: imports `./supabase/server`, which imports `next/headers`.
 */

import { createServiceClient } from '@/lib/supabase/server';

export const BUCKET = 'pptalk-private';

// ---------------------------------------------------------------------------
// Pure path helpers (mirror pipeline/narrator/storage.py)
// ---------------------------------------------------------------------------

export const sourcePath = (
  userId: string,
  projectId: string,
  ext: 'pptx' | 'pdf',
): string => `${userId}/${projectId}/source/deck.${ext}`;

export const slidePngPath = (
  userId: string,
  projectId: string,
  idx: number,
): string => `${userId}/${projectId}/slides/${String(idx).padStart(3, '0')}.png`;

export const slideAudioPath = (
  userId: string,
  projectId: string,
  idx: number,
): string => `${userId}/${projectId}/audio/${String(idx).padStart(3, '0')}.mp3`;

export const renderMp4Path = (
  userId: string,
  projectId: string,
  renderId: string,
): string => `${userId}/${projectId}/renders/${renderId}.mp4`;

export const renderSrtPath = (
  userId: string,
  projectId: string,
  renderId: string,
): string => `${userId}/${projectId}/renders/${renderId}.srt`;

// ---------------------------------------------------------------------------
// Storage operations (service-role)
// ---------------------------------------------------------------------------

const CONTENT_TYPES: Record<'pptx' | 'pdf', string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
};

/**
 * Upload a source deck (PPTX or PDF) to storage. Upserts so retries on the
 * same project overwrite cleanly. Returns the storage key.
 */
export async function uploadDeck(
  userId: string,
  projectId: string,
  file: File | Blob,
  ext: 'pptx' | 'pdf',
): Promise<string> {
  const path = sourcePath(userId, projectId, ext);
  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: CONTENT_TYPES[ext],
    upsert: true,
  });
  if (error) {
    throw new Error(`Failed to upload deck to ${path}: ${error.message}`);
  }
  return path;
}

/**
 * Create a signed URL for the given storage key.
 *
 * Default 1-hour expiry — appropriate for short-lived flows (download links,
 * single-shot reads). For things rendered persistently in the editor (slide
 * thumbnails, audio previews), use `getPublicSignedUrl` instead.
 */
export async function signedUrl(
  path: string,
  expiresInSeconds: number = 60 * 60,
): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to sign URL for ${path}: ${error?.message ?? 'no signedUrl in response'}`,
    );
  }
  return data.signedUrl;
}

/**
 * Longer-lived signed URL (24h default) for editor surfaces where a 1-hour
 * expiry causes flicker / re-fetch on long sessions. Same underlying call —
 * the only difference is the default.
 */
export async function getPublicSignedUrl(
  path: string,
  expiresInSeconds: number = 60 * 60 * 24,
): Promise<string> {
  return signedUrl(path, expiresInSeconds);
}
