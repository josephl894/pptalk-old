/**
 * Anonymous-cookie identity.
 *
 * No Supabase Auth (yet). Each browser carries an opaque UUIDv7 cookie
 * (`pptalk_uid`); on the server we upsert that value into `users.browser_id`
 * and treat the resulting row as the current user.
 *
 * When real auth lands (Phase 5), authed sessions will be linked to the
 * existing `browser_id` row by associating an email — no migration of project
 * ownership required.
 *
 * Server-only: imports `next/headers`. Calling from a client component will
 * fail at module load.
 */

import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';

import { db, users, type User } from '@/lib/db';

const COOKIE_NAME = 'pptalk_uid';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  };
}

/**
 * Read the `pptalk_uid` cookie value without creating a user row.
 *
 * Returns null if the cookie isn't set. Useful in middleware where we want a
 * quick identity probe without DB I/O.
 *
 * Note: this is async because Next 15's `cookies()` is async. Despite the
 * spec'd name `readBrowserId` suggesting sync, we have to await `cookies()`.
 */
export async function readBrowserId(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

/**
 * Read the `pptalk_uid` cookie; if missing, generate a new UUIDv7 and set it.
 * Upsert into `users` keyed on `browser_id`, then return the row.
 *
 * Use from server components, server actions, and route handlers. Do not call
 * from client components — `next/headers` will throw.
 */
export async function getCurrentUser(): Promise<User> {
  const store = await cookies();
  let browserId = store.get(COOKIE_NAME)?.value;

  if (!browserId) {
    browserId = uuidv7();
    // Cookie writes are silently dropped from server components but go through
    // from route handlers / server actions. The user row still gets created
    // either way — the next request from the browser will simply re-mint and
    // create a new row if we're in a read-only context. In practice
    // `getCurrentUser` is invoked from route handlers where this works.
    try {
      store.set(COOKIE_NAME, browserId, cookieOptions());
    } catch {
      // Server-component context, cookies are read-only here. Caller should
      // either invoke this from a route handler / action, or accept that the
      // cookie won't be persisted and a new row will be created next time.
    }
  }

  await db
    .insert(users)
    .values({ id: uuidv7(), browserId, isSystem: false })
    .onConflictDoUpdate({
      target: users.browserId,
      set: { updatedAt: new Date() },
    });

  const rows = await db.select().from(users).where(eq(users.browserId, browserId)).limit(1);
  const user = rows[0];
  if (!user) {
    // Should be unreachable: we just upserted on this browserId.
    throw new Error(`Failed to load user row for browser_id=${browserId}`);
  }
  return user;
}
