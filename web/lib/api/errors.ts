/**
 * Consistent JSON error responses for API routes.
 *
 * Every error has the shape `{ error: string }` so clients can render the
 * message verbatim or branch on the status code.
 */

import { NextResponse } from 'next/server';

export function unauthorized(message: string = 'Unauthorized'): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message: string = 'Forbidden'): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message: string = 'Not found'): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError(e: unknown): NextResponse {
  const message = e instanceof Error ? e.message : String(e);
  // Server errors are logged for the operator; the client gets the message.
  console.error('[api]', message, e);
  return NextResponse.json({ error: message }, { status: 500 });
}
