import pg, { Pool, PoolClient } from 'pg';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

// Parse PostgreSQL DATE type (OID 1082) as exact YYYY-MM-DD string to avoid timezone shifting
pg.types.setTypeParser(1082, (str: string) => str);

const isLocalDb =
  env.DATABASE_URL.includes('localhost') ||
  env.DATABASE_URL.includes('127.0.0.1') ||
  env.DATABASE_URL.includes('@postgres:');

const useSsl =
  process.env.PGSSLMODE === 'require' ||
  env.DATABASE_URL.includes('sslmode=require') ||
  (env.NODE_ENV === 'production' && !isLocalDb);

export let pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: 30, // Support concurrent requests up to 30 pool connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('Unexpected idle client error on PostgreSQL pool', err);
});

export function setPool(newPool: Pool) {
  pool = newPool;
}

export async function withTransaction<T>(
  poolOrCallback: Pool | ((client: PoolClient) => Promise<T>),
  maybeCallback?: (client: PoolClient) => Promise<T>
): Promise<T> {
  const p: Pool = typeof poolOrCallback === 'function' ? pool : poolOrCallback;
  const cb: (client: PoolClient) => Promise<T> =
    typeof poolOrCallback === 'function' ? poolOrCallback : maybeCallback!;

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('Error during transaction rollback', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

