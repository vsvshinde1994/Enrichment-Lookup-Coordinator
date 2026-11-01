import { default as EmbeddedPostgres } from 'embedded-postgres';
import pg, { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

pg.types.setTypeParser(1082, (str: string) => str);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PG_PORT = 54339;
const PG_DATA_DIR = path.resolve(__dirname, '../.test-real-pg');

let embeddedPg: EmbeddedPostgres | null = null;
let testPool: Pool | null = null;

export async function startRealPostgres(): Promise<Pool> {
  if (testPool) return testPool;

  // Clean stale directory if present
  if (fs.existsSync(PG_DATA_DIR)) {
    fs.rmSync(PG_DATA_DIR, { recursive: true, force: true });
  }

  embeddedPg = new EmbeddedPostgres({
    port: PG_PORT,
    databaseDir: PG_DATA_DIR,
    user: 'postgres',
    password: 'password',
    persistent: false,
  });

  await embeddedPg.initialise();

  // Configure high connection limits and UTC timezone for concurrency tests
  const confPath = path.join(PG_DATA_DIR, 'postgresql.conf');
  if (fs.existsSync(confPath)) {
    fs.appendFileSync(confPath, "\nmax_connections = 300\ntimezone = 'UTC'\n");
  }

  await embeddedPg.start();

  testPool = new Pool({
    connectionString: `postgresql://postgres:password@127.0.0.1:${PG_PORT}/postgres`,
    max: 35,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });

  testPool.on('error', (_err) => {
    // Suppress idle client termination warnings during test teardown
  });

  // Apply schema
  const schemaPath = path.resolve(__dirname, '../src/db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await testPool.query(schemaSql);

  return testPool;
}

export async function cleanDatabase(): Promise<void> {
  if (!testPool) return;
  await testPool.query(`TRUNCATE TABLE enrichment_requests, daily_quotas RESTART IDENTITY CASCADE;`);
}

export async function stopRealPostgres(): Promise<void> {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
  if (embeddedPg) {
    await embeddedPg.stop();
    embeddedPg = null;
  }
  if (fs.existsSync(PG_DATA_DIR)) {
    fs.rmSync(PG_DATA_DIR, { recursive: true, force: true });
  }
}
