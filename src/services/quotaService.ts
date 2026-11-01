import { PoolClient, Pool } from 'pg';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { DailyQuotaDTO, DailyQuotaRow } from '../types/index.js';

export function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export class QuotaService {
  /**
   * Concurrency-safe initialization of today's quota row using parameterized query.
   */
  async ensureQuotaRow(clientOrPool: PoolClient | Pool = pool, targetDate = getTodayDateString()): Promise<void> {
    await clientOrPool.query(
      `INSERT INTO daily_quotas (quota_date, max_limit, reserved_count, consumed_count)
       VALUES ($1, $2, 0, 0)
       ON CONFLICT (quota_date) DO NOTHING;`,
      [targetDate, env.DAILY_QUOTA_LIMIT]
    );
  }

  /**
   * Retrieves today's quota statistics.
   */
  async getTodayQuota(clientOrPool: PoolClient | Pool = pool, targetDate = getTodayDateString()): Promise<DailyQuotaDTO> {
    // Ensure row exists
    await this.ensureQuotaRow(clientOrPool, targetDate);

    const [result, queuedRes] = await Promise.all([
      clientOrPool.query<DailyQuotaRow>(
        `SELECT quota_date, max_limit, reserved_count, consumed_count, created_at, updated_at
         FROM daily_quotas
         WHERE quota_date = $1;`,
        [targetDate]
      ),
      clientOrPool.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM enrichment_requests WHERE status = 'QUEUED';`
      ),
    ]);

    const row = result.rows[0];
    const available = Math.max(0, row.max_limit - (row.reserved_count + row.consumed_count));
    const queuedCount = parseInt(queuedRes.rows[0]?.count ?? '0', 10);

    return {
      quotaDate: typeof row.quota_date === 'string' ? row.quota_date : new Date(row.quota_date).toISOString().slice(0, 10),
      maxLimit: row.max_limit,
      reservedCount: row.reserved_count,
      consumedCount: row.consumed_count,
      availableCount: available,
      queuedCount,
    };
  }
}

export const quotaService = new QuotaService();
