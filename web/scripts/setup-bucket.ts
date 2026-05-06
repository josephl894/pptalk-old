/**
 * Idempotent: create the `pptalk-private` Supabase Storage bucket if it
 * doesn't already exist. Storage buckets are not created by SQL migrations.
 *
 * Run with: `npx tsx scripts/setup-bucket.ts` from `web/`.
 */
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Next.js convention: `.env.local` overrides `.env`. Scripts (run via tsx)
// don't get this for free, so load it explicitly.
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');

const supabase = createClient(url, serviceKey);

const BUCKET = 'pptalk-private';

async function main() {
  const { data: existing, error: getErr } = await supabase.storage.getBucket(BUCKET);
  if (existing) {
    console.log(`Bucket ${BUCKET} already exists`);
    return;
  }
  // getBucket returns an error when the bucket is missing — only treat
  // unexpected errors as fatal; "Bucket not found" is the happy path.
  if (getErr && !/not found/i.test(getErr.message)) {
    throw getErr;
  }
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: '500MB',
    allowedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
      'application/pdf',
      'image/png',
      'audio/mpeg',
      'video/mp4',
      'application/x-subrip', // srt
      'text/plain',
    ],
  });
  if (error) throw error;
  console.log(`Created bucket ${BUCKET}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
