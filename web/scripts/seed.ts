/**
 * Idempotent seed script.
 *
 *   1. Upserts the `system` user (browser_id='system', is_system=true).
 *   2. If a sample project named "Public Health: Prevention Effectiveness"
 *      already exists for that user, skip everything else (idempotent).
 *   3. Otherwise:
 *      - Upload `samples/introduction-to-prevention-effectiveness.pptx` to
 *        `${SYSTEM_USER_ID}/${projectId}/source/deck.pptx`.
 *      - Upload `out/prevention_full.mp4` to
 *        `${SYSTEM_USER_ID}/${projectId}/renders/${renderId}.mp4`.
 *      - INSERT into `projects` (status='rendered', is_sample=true).
 *      - INSERT into `renders` (no slide rows, no captions yet).
 *
 * Run with: `npx tsx scripts/seed.ts` from `web/`.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import * as schema from '../lib/db/schema';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SAMPLE_PPTX = path.join(REPO_ROOT, 'samples', 'introduction-to-prevention-effectiveness.pptx');
const SAMPLE_MP4 = path.join(REPO_ROOT, 'out', 'prevention_full.mp4');
const SAMPLE_PROJECT_NAME = 'Public Health: Prevention Effectiveness';
const BUCKET = 'pptalk-private';

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');

const sql = postgres(databaseUrl, { prepare: false });
const db = drizzle(sql, { schema });
const supabase = createClient(supabaseUrl, serviceKey);

async function main() {
  // 1. Upsert system user. ON CONFLICT (browser_id) DO NOTHING. Then SELECT.
  const newUserId = uuidv7();
  await db
    .insert(schema.users)
    .values({
      id: newUserId,
      browserId: 'system',
      isSystem: true,
    })
    .onConflictDoNothing({ target: schema.users.browserId });

  const [systemUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.browserId, 'system'))
    .limit(1);
  if (!systemUser) throw new Error('Failed to upsert system user');
  const SYSTEM_USER_ID = systemUser.id;
  console.log(`system user id: ${SYSTEM_USER_ID}`);

  // 2. Idempotency check: does the sample project already exist?
  const existingSample = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.userId, SYSTEM_USER_ID),
        eq(schema.projects.name, SAMPLE_PROJECT_NAME),
        eq(schema.projects.isSample, true),
      ),
    )
    .limit(1);
  if (existingSample.length > 0) {
    console.log(`sample project already exists (id=${existingSample[0].id}); skipping`);
    return;
  }

  // 3. Generate ids and upload artifacts.
  const projectId = uuidv7();
  const renderId = uuidv7();
  const sourcePath = `${SYSTEM_USER_ID}/${projectId}/source/deck.pptx`;
  const renderPath = `${SYSTEM_USER_ID}/${projectId}/renders/${renderId}.mp4`;

  console.log(`uploading PPTX to ${sourcePath} ...`);
  const pptxBytes = await readFile(SAMPLE_PPTX);
  {
    const { error } = await supabase.storage.from(BUCKET).upload(sourcePath, pptxBytes, {
      contentType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      upsert: true,
    });
    if (error) throw new Error(`PPTX upload failed: ${error.message}`);
  }

  console.log(`uploading MP4 to ${renderPath} ...`);
  const mp4Bytes = await readFile(SAMPLE_MP4);
  {
    const { error } = await supabase.storage.from(BUCKET).upload(renderPath, mp4Bytes, {
      contentType: 'video/mp4',
      upsert: true,
    });
    if (error) throw new Error(`MP4 upload failed: ${error.message}`);
  }
  const mp4Stat = await stat(SAMPLE_MP4);

  // 4. Insert rows.
  await db.insert(schema.projects).values({
    id: projectId,
    userId: SYSTEM_USER_ID,
    name: SAMPLE_PROJECT_NAME,
    sourceKind: 'pptx',
    sourcePath,
    aspectW: 1920,
    aspectH: 1080,
    numSlides: 20,
    status: 'rendered',
    isSample: true,
  });

  await db.insert(schema.renders).values({
    id: renderId,
    projectId,
    mp4Path: renderPath,
    captions: false,
    videoBytes: mp4Stat.size,
  });

  console.log(`seeded project ${projectId} with render ${renderId} (${mp4Stat.size} bytes)`);
  console.log('TODO: corporate-skills sample needs sourcing; not seeded');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
