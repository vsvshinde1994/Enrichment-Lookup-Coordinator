import pkg from 'pg-mem';
const { newDb } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function setupTestDatabase(): { db: any; pool: any } {
  const db = newDb();

  // Register uuid generator that returns new uuid per invocation
  db.public.registerFunction({
    name: 'gen_random_uuid',
    impure: true,
    returns: db.public.getType('uuid'),
    implementation: () => crypto.randomUUID(),
  });

  db.public.registerFunction({
    name: 'greatest',
    args: [db.public.getType('integer'), db.public.getType('integer')],
    returns: db.public.getType('integer'),
    implementation: (a: number, b: number) => Math.max(a, b),
  });

  const schemaPath = path.resolve(__dirname, '../src/db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.public.none(schemaSql);

  const pg = db.adapters.createPg();
  const pool = new pg.Pool();

  return { db, pool };
}
