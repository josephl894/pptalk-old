import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Drizzle generates migration SQL into the same folder Supabase CLI tracks,
// so `supabase db push` (Phase 0F) applies them as part of the normal flow.
export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
