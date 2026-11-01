import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { ensureDatabaseConnection, stopEmbeddedDatabase } from './config/devDatabase.js';
import { runMigrations } from './db/migrate.js';
import { leaseReaper } from './worker/leaseReaper.js';
import { logger } from './utils/logger.js';

async function bootstrap() {
  try {
    // Check connection; in development, automatically launch embedded PostgreSQL if needed
    await ensureDatabaseConnection();

    logger.info('Running database migrations...');
    await runMigrations();

    // Start background lease reaper and queue promotion worker
    leaseReaper.start();

    const server = app.listen(env.PORT, () => {
      logger.info(`Enrichment Lookup Coordinator API running on port ${env.PORT} [${env.NODE_ENV}]`);
    });

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Gracefully shutting down...`);
      leaseReaper.stop();
      server.close(async () => {
        logger.info('HTTP server closed. Draining database connection pool...');
        try {
          await pool.end();
        } catch {}
        await stopEmbeddedDatabase();
        logger.info('Clean shutdown completed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Fatal startup error in bootstrap()', err);
    await stopEmbeddedDatabase();
    process.exit(1);
  }
}

bootstrap();
