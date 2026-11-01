import pg, { Pool } from 'pg';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool, setPool } from './db.js';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_PG_PORT = 54332;
const DEV_PG_URL = `postgresql://postgres:password@127.0.0.1:${DEV_PG_PORT}/postgres`;

let embeddedServer: any = null;

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifies PostgreSQL connectivity. If unreachable in development mode,
 * automatically starts or connects to the native embedded PostgreSQL instance on port 54332.
 */
export async function ensureDatabaseConnection(): Promise<void> {
  // 1. Test connection to the primary configured pool (e.g. 5432)
  try {
    const client = await pool.connect();
    client.release();
    logger.info(`Connected to PostgreSQL database at ${env.DATABASE_URL}`);
    return;
  } catch (err: any) {
    const isConnRefused =
      err?.code === 'ECONNREFUSED' ||
      err?.message?.includes('ECONNREFUSED') ||
      (Array.isArray(err?.errors) && err.errors.some((e: any) => e?.code === 'ECONNREFUSED'));

    if (!isConnRefused || env.NODE_ENV === 'production') {
      throw err;
    }

    logger.warn(`No PostgreSQL server detected at ${env.DATABASE_URL}.`);
  }

  // 2. Check if a development PostgreSQL is already running on port 54332
  const existingDevPool = new Pool({
    connectionString: DEV_PG_URL,
    max: 25,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 1500,
  });

  try {
    const testClient = await existingDevPool.connect();
    testClient.release();
    logger.info(`Connected to existing local development PostgreSQL on port ${DEV_PG_PORT}.`);
    setPool(existingDevPool);
    return;
  } catch {
    // Not running yet, proceed to start embedded instance
    await existingDevPool.end().catch(() => {});
  }

  // 3. Launch embedded native PostgreSQL instance
  logger.info(`🚀 Starting native PostgreSQL server for local development on 127.0.0.1:${DEV_PG_PORT}...`);

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dbDir = path.resolve(__dirname, '../../.dev-pg-data');

  // Clean stale lockfile if process is dead
  const pidFilePath = path.join(dbDir, 'postmaster.pid');
  if (fs.existsSync(pidFilePath)) {
    try {
      const pidContent = fs.readFileSync(pidFilePath, 'utf8');
      const pid = parseInt(pidContent.split('\n')[0].trim(), 10);
      if (!isProcessRunning(pid)) {
        logger.info(`Cleaning stale postmaster.pid (PID: ${pid})...`);
        fs.unlinkSync(pidFilePath);
      }
    } catch {
      // Ignored
    }
  }

  embeddedServer = new EmbeddedPostgres({
    port: DEV_PG_PORT,
    databaseDir: dbDir,
    user: 'postgres',
    password: 'password',
    persistent: true,
  });

  const isFirstTime = !fs.existsSync(path.join(dbDir, 'PG_VERSION'));
  if (isFirstTime) {
    await embeddedServer.initialise();
    const confPath = path.join(dbDir, 'postgresql.conf');
    if (fs.existsSync(confPath)) {
      fs.appendFileSync(confPath, "\nmax_connections = 150\ntimezone = 'UTC'\n");
    }
  }

  await embeddedServer.start();
  logger.info(`Native PostgreSQL 18 started successfully on port ${DEV_PG_PORT}.`);

  // Create active development connection pool
  const devPool = new Pool({
    connectionString: DEV_PG_URL,
    max: 25,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });

  devPool.on('error', (poolErr) => {
    logger.error('Unexpected error on dev PostgreSQL pool', poolErr);
  });

  setPool(devPool);
}

/**
 * Gracefully shuts down the embedded database if running.
 */
export async function stopEmbeddedDatabase(): Promise<void> {
  if (embeddedServer) {
    try {
      logger.info('Stopping embedded PostgreSQL dev server...');
      await embeddedServer.stop();
      logger.info('Embedded PostgreSQL dev server stopped.');
    } catch (err) {
      logger.error('Error stopping embedded PostgreSQL dev server', err);
    } finally {
      embeddedServer = null;
    }
  }
}
