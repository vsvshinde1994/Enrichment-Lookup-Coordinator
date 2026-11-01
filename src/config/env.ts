import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/enrichment_coordinator'),
  DAILY_QUOTA_LIMIT: z.coerce.number().int().positive().default(10),
  LEASE_DURATION_SECONDS: z.coerce.number().int().positive().default(300),
  REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

