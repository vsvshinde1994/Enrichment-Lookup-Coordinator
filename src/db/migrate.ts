import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  logger.info('Executing database migrations...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);

    // Initialize today's quota row idempotently
    await client.query(
      `INSERT INTO daily_quotas (quota_date, max_limit, reserved_count, consumed_count)
       VALUES (CURRENT_DATE, $1, 0, 0)
       ON CONFLICT (quota_date) DO NOTHING;`,
      [env.DAILY_QUOTA_LIMIT]
    );

    await client.query('COMMIT');
    logger.info('Database migrations completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to run migrations', err);
    throw err;
  } finally {
    client.release();
  }
}

// Allow direct execution: tsx src/db/migrate.ts
if (process.argv[1] === __filename) {
  import('../config/devDatabase.js')
    .then(({ ensureDatabaseConnection }) => ensureDatabaseConnection())
    .then(() => runMigrations())
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

