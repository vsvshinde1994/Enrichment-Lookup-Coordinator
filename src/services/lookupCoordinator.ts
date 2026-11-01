import { PoolClient, Pool } from 'pg';
import { pool as defaultPool, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { normalizeIndicator } from '../utils/normalize.js';
import { logger } from '../utils/logger.js';
import { mockProvider as defaultMockProvider, MockProvider } from './mockProvider.js';
import { getTodayDateString } from './quotaService.js';
import {
  CreateEnrichmentInput,
  DailyQuotaRow,
  EnrichmentRequestRow,
  EnrichmentResponseDTO,
  VerdictResult,
} from '../types/index.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public data?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class DuplicateActiveIndicatorError extends AppError {
  constructor(public existingRequestId: string, indicator: string) {
    super(
      409,
      `An active request (QUEUED or LEASED) already exists for normalized indicator: ${indicator}`,
      'DUPLICATE_ACTIVE_INDICATOR',
      { existingRequestId, indicator }
    );
  }
}

export class LookupCoordinatorService {
  constructor(
    private customPool?: Pool,
    private provider: MockProvider = defaultMockProvider
  ) {}

  public get pool(): Pool {
    return this.customPool || defaultPool;
  }

  /**
   * Transforms a database row into an API DTO with relative queue position and countdown.
   */
  async formatResponse(
    row: EnrichmentRequestRow,
    clientOrPool: PoolClient | Pool = this.pool
  ): Promise<EnrichmentResponseDTO> {
    let relativePosition: number | undefined;
    let secondsRemaining: number | null = null;

    if (row.status === 'QUEUED') {
      const posRes = await clientOrPool.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count 
         FROM enrichment_requests 
         WHERE status = 'QUEUED' AND queue_position <= $1;`,
        [row.queue_position]
      );
      relativePosition = parseInt(posRes.rows[0]?.count ?? '1', 10);
    }

    if (row.status === 'LEASED' && row.lease_expires_at) {
      const nowMs = Date.now();
      const expiresMs = new Date(row.lease_expires_at).getTime();
      secondsRemaining = Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
    }

    return {
      id: row.id,
      analystId: row.analyst_id,
      indicator: row.indicator,
      normalizedIndicator: row.normalized_indicator,
      status: row.status,
      queuePosition: row.queue_position !== null ? Number(row.queue_position) : null,
      relativeQueuePosition: relativePosition,
      leaseAcquiredAt: row.lease_acquired_at ? new Date(row.lease_acquired_at).toISOString() : null,
      leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
      leaseSecondsRemaining: secondsRemaining,
      verdict: row.verdict,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  /**
   * Concurrency-safe, transactional reservation and queuing.
   * Handles idempotency and duplicate active indicators at the database level.
   */
  async createRequest(
    input: CreateEnrichmentInput,
    overrideClient?: PoolClient,
    targetDate: string = getTodayDateString()
  ): Promise<{ dto: EnrichmentResponseDTO; isRetry: boolean }> {
    const { analystId, idempotencyKey, indicator } = input;

    if (!analystId || !idempotencyKey || !indicator) {
      throw new AppError(400, 'analystId, idempotencyKey, and indicator are required.');
    }

    const normalized = normalizeIndicator(indicator);

    const executeInClient = async (client: PoolClient) => {
      // 1. Idempotency Check: Return existing request if identical (analyst_id, idempotency_key)
      const existingKeyResult = await client.query<EnrichmentRequestRow>(
        `SELECT * FROM enrichment_requests 
         WHERE analyst_id = $1 AND idempotency_key = $2;`,
        [analystId, idempotencyKey]
      );

      if (existingKeyResult.rows.length > 0) {
        logger.info('Idempotent request replayed', {
          analystId,
          idempotencyKey,
          requestId: existingKeyResult.rows[0].id,
        });
        const dto = await this.formatResponse(existingKeyResult.rows[0], client);
        return { dto, isRetry: true };
      }

      // 2. Lock and attempt atomic quota reservation for target date
      await client.query(
        `INSERT INTO daily_quotas (quota_date, max_limit, reserved_count, consumed_count)
         VALUES ($1, $2, 0, 0)
         ON CONFLICT (quota_date) DO NOTHING;`,
        [targetDate, env.DAILY_QUOTA_LIMIT]
      );

      // Lock row FOR UPDATE for strict lock ordering
      await client.query(
        `SELECT quota_date FROM daily_quotas WHERE quota_date = $1 FOR UPDATE;`,
        [targetDate]
      );

      // Atomic conditional reservation: increments reserved_count ONLY IF capacity exists
      const reserveRes = await client.query<DailyQuotaRow>(
        `UPDATE daily_quotas
         SET reserved_count = reserved_count + 1, updated_at = NOW()
         WHERE quota_date = $1
           AND (reserved_count + consumed_count) < max_limit
         RETURNING *;`,
        [targetDate]
      );

      let createdRow: EnrichmentRequestRow;

      try {
        if (reserveRes.rows.length > 0) {
          // Slot successfully reserved -> grant immediate 5-minute lease
          const insertRes = await client.query<EnrichmentRequestRow>(
            `INSERT INTO enrichment_requests (
               analyst_id, idempotency_key, indicator, normalized_indicator,
               status, quota_date, lease_acquired_at, lease_expires_at
             )
             VALUES ($1, $2, $3, $4, 'LEASED', $5, NOW(), NOW() + INTERVAL '300 seconds')
             RETURNING *;`,
            [analystId, idempotencyKey, indicator, normalized, targetDate]
          );

          createdRow = insertRes.rows[0];
        } else {
          // Capacity full -> Enqueue request in FIFO order
          const insertRes = await client.query<EnrichmentRequestRow>(
            `INSERT INTO enrichment_requests (
               analyst_id, idempotency_key, indicator, normalized_indicator,
               status, quota_date
             )
             VALUES ($1, $2, $3, $4, 'QUEUED', $5)
             RETURNING *;`,
            [analystId, idempotencyKey, indicator, normalized, targetDate]
          );

          createdRow = insertRes.rows[0];
        }
      } catch (err: any) {
        // Handle database-enforced unique constraints
        if (
          err.code === '23505' ||
          err.message?.includes('duplicate key') ||
          err.message?.includes('violates unique constraint')
        ) {
          if (
            err.constraint === 'uq_active_normalized_indicator' ||
            err.message?.includes('uq_active_normalized_indicator') ||
            err.message?.includes('normalized_indicator')
          ) {
            throw new DuplicateActiveIndicatorError('active-conflict', normalized);
          }
          if (
            err.constraint === 'uq_analyst_idempotency' ||
            err.message?.includes('uq_analyst_idempotency') ||
            err.message?.includes('idempotency_key')
          ) {
            const existing = await client.query<EnrichmentRequestRow>(
              `SELECT * FROM enrichment_requests WHERE analyst_id = $1 AND idempotency_key = $2;`,
              [analystId, idempotencyKey]
            );
            if (existing.rows[0]) {
              const dto = await this.formatResponse(existing.rows[0], client);
              return { dto, isRetry: true };
            }
          }
        }
        throw err;
      }

      const dto = await this.formatResponse(createdRow, client);
      return { dto, isRetry: false };
    };

    if (overrideClient) {
      await overrideClient.query('BEGIN');
      try {
        const result = await executeInClient(overrideClient);
        await overrideClient.query('COMMIT');
        return result;
      } catch (e) {
        try {
          await overrideClient.query('ROLLBACK');
        } catch {}
        throw e;
      }
    }

    const runnerClient = await this.pool.connect();
    try {
      await runnerClient.query('BEGIN');
      const result = await executeInClient(runnerClient);
      await runnerClient.query('COMMIT');
      return result;
    } catch (e) {
      try {
        await runnerClient.query('ROLLBACK');
      } catch {}
      throw e;
    } finally {
      runnerClient.release();
    }
  }

  /**
   * Idempotent lookup execution using a Non-Blocking Two-Phase Claim Pattern.
   * NEVER holds a database transaction open during external mock provider calls.
   */
  async executeLookup(
    requestId: string,
    analystId: string,
    clientOrPool: PoolClient | Pool = this.pool
  ): Promise<EnrichmentResponseDTO> {
    if (!requestId || !analystId) {
      throw new AppError(400, 'requestId and analystId are required.');
    }

    // Step 1: Atomic Claim Phase (Fast single query)
    const claimResult = await clientOrPool.query<EnrichmentRequestRow>(
      `UPDATE enrichment_requests
       SET status = 'EXECUTING',
           execution_started_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND analyst_id = $2
         AND status = 'LEASED'
         AND lease_expires_at > NOW()
       RETURNING *;`,
      [requestId, analystId]
    );

    let claimedRequest = claimResult.rows[0];

    // If 0 rows updated, inspect reason to ensure idempotency and return meaningful error
    if (!claimedRequest) {
      const inspectRes = await clientOrPool.query<EnrichmentRequestRow>(
        `SELECT * FROM enrichment_requests WHERE id = $1;`,
        [requestId]
      );

      if (inspectRes.rows.length === 0) {
        throw new AppError(404, 'Enrichment request not found.');
      }

      const current = inspectRes.rows[0];

      if (current.analyst_id !== analystId) {
        throw new AppError(403, 'Forbidden: Analyst does not own this request.');
      }

      // Idempotent retry: already completed, return cached verdict
      if (current.status === 'COMPLETED') {
        return await this.formatResponse(current, clientOrPool);
      }

      // In flight by concurrent execute call
      if (current.status === 'EXECUTING') {
        throw new AppError(409, 'Lookup execution is currently in progress for this request.');
      }

      // Lease expired
      if (
        current.status === 'EXPIRED' ||
        (current.status === 'LEASED' && current.lease_expires_at && new Date(current.lease_expires_at) <= new Date())
      ) {
        throw new AppError(410, 'Lease has expired. Quota slot is no longer reserved for this request.');
      }

      if (current.status === 'QUEUED') {
        throw new AppError(400, 'Request is still in QUEUED status. A valid lease is required to run lookup.');
      }

      if (current.status === 'FAILED') {
        throw new AppError(400, `Request previously failed: ${current.error_message || 'Unknown error'}`);
      }

      throw new AppError(400, `Cannot execute request in status: ${current.status}`);
    }

    // Track original quota period for this lease
    const leaseQuotaDate = claimedRequest.quota_date
      ? typeof claimedRequest.quota_date === 'string'
        ? claimedRequest.quota_date.slice(0, 10)
        : new Date(claimedRequest.quota_date).toISOString().slice(0, 10)
      : getTodayDateString();

    // Step 2: External Mock Provider Call (OUTSIDE of any database transaction)
    let verdictResult: VerdictResult;
    try {
      verdictResult = await this.provider.lookup(claimedRequest.indicator);
    } catch (providerErr: any) {
      logger.error('Mock provider execution failed', providerErr);

      // Finalize failure and release reservation for original quota period
      await clientOrPool.query(
        `UPDATE enrichment_requests
         SET status = 'FAILED', error_message = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'EXECUTING';`,
        [requestId, providerErr.message || 'Provider execution failed']
      );
      await clientOrPool.query(
        `UPDATE daily_quotas
         SET reserved_count = GREATEST(0, reserved_count - 1), updated_at = NOW()
         WHERE quota_date = $1;`,
        [leaseQuotaDate]
      );

      throw new AppError(502, `External provider lookup failed: ${providerErr.message}`);
    }

    // Step 3: Finalize Consumption Transaction
    // Permanently consume quota (reserved -> consumed) for original quota period
    const updateReqRes = await clientOrPool.query<EnrichmentRequestRow>(
      `UPDATE enrichment_requests
       SET status = 'COMPLETED',
           verdict = $2,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status = 'EXECUTING'
       RETURNING *;`,
      [requestId, JSON.stringify(verdictResult)]
    );

    await clientOrPool.query(
      `UPDATE daily_quotas
       SET reserved_count = GREATEST(0, reserved_count - 1),
           consumed_count = consumed_count + 1,
           updated_at = NOW()
       WHERE quota_date = $1;`,
      [leaseQuotaDate]
    );

    return await this.formatResponse(updateReqRes.rows[0], clientOrPool);
  }

  /**
   * Concurrency-safe expiration and queue promotion.
   * Safe to run repeatedly and across multiple worker instances.
   */
  async reconcileExpiredLeasesAndPromote(
    clientOrPool: PoolClient | Pool = this.pool,
    targetDate: string = getTodayDateString()
  ): Promise<{ expiredCount: number; promotedCount: number }> {
    // If called with a connection pool, wrap the entire reconciliation and promotion in a single ACID transaction
    if (!('release' in clientOrPool)) {
      return withTransaction(clientOrPool as Pool, (txClient) =>
        this.reconcileExpiredLeasesAndPromote(txClient, targetDate)
      );
    }

    await clientOrPool.query(
      `INSERT INTO daily_quotas (quota_date, max_limit, reserved_count, consumed_count)
       VALUES ($1, $2, 0, 0)
       ON CONFLICT (quota_date) DO NOTHING;`,
      [targetDate, env.DAILY_QUOTA_LIMIT]
    );

    // Atomically mark expired leases and get their assigned quota dates
    const expiredRes = await clientOrPool.query<{ id: string; quota_date: Date | string }>(
      `UPDATE enrichment_requests
       SET status = 'EXPIRED', updated_at = NOW()
       WHERE status = 'LEASED' AND lease_expires_at <= NOW()
       RETURNING id, quota_date;`
    );

    const expiredCount = expiredRes.rows.length;

    // Release reservations for each expired lease's quota period
    for (const exp of expiredRes.rows) {
      const qDate = exp.quota_date
        ? typeof exp.quota_date === 'string'
          ? exp.quota_date.slice(0, 10)
          : new Date(exp.quota_date).toISOString().slice(0, 10)
        : targetDate;

      await clientOrPool.query(
        `UPDATE daily_quotas
         SET reserved_count = GREATEST(0, reserved_count - 1), updated_at = NOW()
         WHERE quota_date = $1;`,
        [qDate]
      );
    }

    // Lock target date's quota row to promote queued requests into target date
    const quotaRes = await clientOrPool.query<DailyQuotaRow>(
      `SELECT quota_date, max_limit, reserved_count, consumed_count
       FROM daily_quotas
       WHERE quota_date = $1
       FOR UPDATE;`,
      [targetDate]
    );

    const quota = quotaRes.rows[0];
    const availableCapacity = Math.max(0, quota.max_limit - (quota.reserved_count + quota.consumed_count));

    let promotedCount = 0;

    // Promote oldest eligible queued requests (FIFO)
    if (availableCapacity > 0) {
      const queuedToPromoteRes = await clientOrPool.query<{ id: string }>(
        `SELECT id FROM enrichment_requests
         WHERE status = 'QUEUED'
         ORDER BY queue_position ASC
         LIMIT $1
         FOR UPDATE;`,
        [availableCapacity]
      );

      const candidateIds = queuedToPromoteRes.rows.map((r) => r.id);

      if (candidateIds.length > 0) {
        let actuallyPromoted = 0;
        for (const reqId of candidateIds) {
          const updateRes = await clientOrPool.query(
            `UPDATE enrichment_requests
             SET status = 'LEASED',
                 quota_date = $2,
                 lease_acquired_at = NOW(),
                 lease_expires_at = NOW() + INTERVAL '300 seconds',
                 updated_at = NOW()
             WHERE id = $1 AND status = 'QUEUED'
             RETURNING id;`,
            [reqId, targetDate]
          );
          if (updateRes.rows.length > 0) {
            actuallyPromoted++;
          }
        }

        if (actuallyPromoted > 0) {
          await clientOrPool.query(
            `UPDATE daily_quotas
             SET reserved_count = reserved_count + $1, updated_at = NOW()
             WHERE quota_date = $2;`,
            [actuallyPromoted, targetDate]
          );
          promotedCount = actuallyPromoted;
        }
      }
    }

    return { expiredCount, promotedCount };
  }

  /**
   * Retrieves single request by ID.
   */
  async getRequestById(id: string, clientOrPool: PoolClient | Pool = this.pool): Promise<EnrichmentResponseDTO> {
    const res = await clientOrPool.query<EnrichmentRequestRow>(
      `SELECT * FROM enrichment_requests WHERE id = $1;`,
      [id]
    );

    if (res.rows.length === 0) {
      throw new AppError(404, 'Enrichment request not found.');
    }

    return await this.formatResponse(res.rows[0], clientOrPool);
  }

  /**
   * Lists recent requests, optionally filtered by analystId.
   */
  async listRequests(analystId?: string, limit = 50, clientOrPool: PoolClient | Pool = this.pool): Promise<EnrichmentResponseDTO[]> {
    let query = `SELECT * FROM enrichment_requests`;
    const params: any[] = [];

    if (analystId) {
      params.push(analystId);
      query += ` WHERE analyst_id = $1`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1};`;
    params.push(limit);

    const res = await clientOrPool.query<EnrichmentRequestRow>(query, params);

    return Promise.all(res.rows.map((row) => this.formatResponse(row, clientOrPool)));
  }
}

export const lookupCoordinator = new LookupCoordinatorService();
