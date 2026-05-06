/**
 * /api/projects
 *
 * POST: upload a deck, create a project, enqueue a parse_only job.
 * GET:  list user's projects + sample projects (samples first).
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';

import { getCurrentUser } from '@/lib/auth';
import {
  db,
  projects,
  renderJobs,
  type Project,
} from '@/lib/db';
import { sourcePath, uploadDeck } from '@/lib/storage';
import { badRequest, serverError, unauthorized } from '@/lib/api/errors';
import { loadLatestRender, serializeProject } from '@/lib/api/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// POST /api/projects
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await getCurrentUser();
  } catch (e) {
    return unauthorized(e instanceof Error ? e.message : 'Unauthorized');
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : 'Invalid multipart body');
  }

  const file = formData.get('file');
  const nameField = formData.get('name');

  if (!file || !(file instanceof File)) {
    return badRequest('Missing file');
  }

  const filename = file.name ?? '';
  const lower = filename.toLowerCase();
  let ext: 'pptx' | 'pdf';
  let sourceKind: 'pptx' | 'pdf';
  if (lower.endsWith('.pptx')) {
    ext = 'pptx';
    sourceKind = 'pptx';
  } else if (lower.endsWith('.pdf')) {
    ext = 'pdf';
    sourceKind = 'pdf';
  } else {
    return badRequest('Unsupported file type. Only .pptx and .pdf are accepted.');
  }

  // Default name = filename stem.
  const stem = filename.replace(/\.(pptx|pdf)$/i, '').trim();
  const projectName =
    typeof nameField === 'string' && nameField.trim().length > 0
      ? nameField.trim()
      : stem || 'Untitled deck';

  const projectId = uuidv7();
  const path = sourcePath(user.id, projectId, ext);

  // Re-wrap as a Blob with the canonical content type. The `File` object
  // produced by `formData.get` carries a generic `application/octet-stream`
  // type from curl uploads, and Supabase Storage validates the request body's
  // declared type against the bucket's allowed_mime_types. Wrapping with a
  // Blob whose `.type` matches the bucket allowlist sidesteps that.
  const CONTENT_TYPES: Record<'pptx' | 'pdf', string> = {
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pdf: 'application/pdf',
  };
  const buf = Buffer.from(await file.arrayBuffer());
  const blob = new Blob([buf], { type: CONTENT_TYPES[ext] });

  try {
    await uploadDeck(user.id, projectId, blob, ext);
  } catch (e) {
    return serverError(e);
  }

  let inserted: Project;
  try {
    const rows = await db
      .insert(projects)
      .values({
        id: projectId,
        userId: user.id,
        name: projectName,
        sourceKind,
        sourcePath: path,
        status: 'parsing',
        isSample: false,
      })
      .returning();
    inserted = rows[0];
  } catch (e) {
    return serverError(e);
  }

  // Enqueue a parse_only job so the worker rasterizes + extracts notes without
  // running TTS / encode. The editor opens against the resulting slides; the
  // user can then trigger full_render explicitly.
  let jobId: string;
  try {
    jobId = uuidv7();
    await db.insert(renderJobs).values({
      id: jobId,
      projectId,
      kind: 'parse_only',
      payload: {},
      status: 'queued',
    });
  } catch (e) {
    return serverError(e);
  }

  return NextResponse.json(
    {
      project: serializeProject(inserted),
      job_id: jobId,
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

export async function GET() {
  let user;
  try {
    user = await getCurrentUser();
  } catch (e) {
    return unauthorized(e instanceof Error ? e.message : 'Unauthorized');
  }

  let rows: Project[];
  try {
    rows = await db
      .select()
      .from(projects)
      .where(
        and(
          or(eq(projects.userId, user.id), eq(projects.isSample, true)),
          isNull(projects.deletedAt),
        ),
      )
      // Samples on top, then most-recently-updated user projects.
      .orderBy(desc(projects.isSample), desc(projects.updatedAt));
  } catch (e) {
    return serverError(e);
  }

  // For each rendered project, fetch its latest render and produce a signed URL.
  const items = await Promise.all(
    rows.map(async (p) => {
      const base = serializeProject(p);
      if (p.status === 'rendered') {
        const latest = await loadLatestRender(p.id);
        if (latest) {
          (base as Record<string, unknown>).latest_render = latest;
        }
      }
      return base;
    }),
  );

  return NextResponse.json(items);
}

