/**
 * Postgres client + Drizzle wrapper.
 *
 * Two things this module guards against:
 *
 * 1. **Connection exhaustion under HMR.** Next dev re-evaluates server modules
 *    on every code change, which makes a fresh `postgres(...)` client each
 *    time. Postgres-side connections from prior evaluations linger until idle
 *    timeout, and after a few HMR cycles we hit Postgres's `too_many_connections`
 *    (53300). The fix is the standard Drizzle/postgres-js HMR pattern — stash
 *    the client on `globalThis` so re-evaluation reuses the same pool.
 *
 * 2. **Pool sizing.** Cap concurrent connections so a single dev process can't
 *    saturate the local Supabase pool, and let idle connections retire so the
 *    server stays well-behaved under bursty traffic.
 */

import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

type GlobalWithPg = typeof globalThis & {
  __pptalk_pg?: ReturnType<typeof postgres>;
};
const g = globalThis as GlobalWithPg;

const client =
  g.__pptalk_pg ??
  postgres(connectionString, {
    // "Transaction" pool mode (Supabase pooler) doesn't support PREPARE.
    prepare: false,
    // Conservative ceiling for a single Next dev / route-handler process.
    max: 10,
    // Retire idle clients after 20s so HMR-orphaned ones stop piling up.
    idle_timeout: 20,
    // Hard cap per connection — refresh the pool every 30 minutes.
    max_lifetime: 60 * 30,
  });

if (process.env.NODE_ENV !== 'production') {
  g.__pptalk_pg = client;
}

export const db = drizzle(client, { schema });

// Re-export schema (tables + inferred types) for convenient single-import use.
export * from './schema';
