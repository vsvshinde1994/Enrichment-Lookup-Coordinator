import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDatabase } from './testDb.js';
import { LookupCoordinatorService, DuplicateActiveIndicatorError } from '../src/services/lookupCoordinator.js';
import { QuotaService, getTodayDateString } from '../src/services/quotaService.js';
import { mockProvider } from '../src/services/mockProvider.js';

describe('Enrichment Lookup Coordinator Backend', () => {
  let testPool: any;
  let coordinator: LookupCoordinatorService;
  let quotaService: QuotaService;

  beforeEach(async () => {
    const { pool } = setupTestDatabase();
    testPool = pool;
    coordinator = new LookupCoordinatorService(testPool);
    quotaService = new QuotaService();
  });

  describe('1. Daily Quota Management & Idempotency', () => {
    it('initializes the daily quota to 10 in a concurrency-safe, idempotent way', async () => {
      await Promise.all([
        quotaService.ensureQuotaRow(testPool),
        quotaService.ensureQuotaRow(testPool),
        quotaService.ensureQuotaRow(testPool),
      ]);

      const quota = await quotaService.getTodayQuota(testPool);
      expect(quota.maxLimit).toBe(10);
      expect(quota.reservedCount).toBe(0);
      expect(quota.consumedCount).toBe(0);
      expect(quota.availableCount).toBe(10);
    });
  });

  describe('2. Idempotency Key Handling', () => {
    it('returns the existing request without creating a duplicate reservation', async () => {
      const client = await testPool.connect();
      // First request
      const res1 = await coordinator.createRequest(
        {
          analystId: 'analyst-1',
          idempotencyKey: 'key-123',
          indicator: 'bad-site.com',
        },
        client
      );

      expect(res1.isRetry).toBe(false);
      expect(res1.dto.status).toBe('LEASED');

      // Retry with same idempotency key and same analyst
      const res2 = await coordinator.createRequest(
        {
          analystId: 'analyst-1',
          idempotencyKey: 'key-123',
          indicator: 'bad-site.com',
        },
        client
      );

      client.release();

      expect(res2.isRetry).toBe(true);
      expect(res2.dto.id).toBe(res1.dto.id);

      // Verify quota was not incremented twice
      const quota = await quotaService.getTodayQuota(testPool);
      expect(quota.reservedCount).toBe(1);
    });
  });

  describe('3. Normalized Indicator Uniqueness', () => {
    it('prevents duplicate active requests for the same normalized indicator', async () => {
      const client = await testPool.connect();

      // Insert active request (LEASED)
      await coordinator.createRequest(
        {
          analystId: 'analyst-1',
          idempotencyKey: 'key-1',
          indicator: 'hxxps://MALWARE.COM/',
        },
        client
      );

      // Attempt to submit another active request for the same normalized indicator
      let duplicateError: any = null;
      try {
        await coordinator.createRequest(
          {
            analystId: 'analyst-2',
            idempotencyKey: 'key-2',
            indicator: 'malware.com',
          },
          client
        );
      } catch (err) {
        duplicateError = err;
      }

      client.release();
      expect(duplicateError).not.toBeNull();
      expect(duplicateError).toBeInstanceOf(DuplicateActiveIndicatorError);
      expect(duplicateError.statusCode).toBe(409);
    });

    it('allows a new request for the indicator after previous request is COMPLETED', async () => {
      const client = await testPool.connect();

      // Request 1 is created
      const r1 = await coordinator.createRequest(
        {
          analystId: 'analyst-1',
          idempotencyKey: 'key-old',
          indicator: 'malware.com',
        },
        client
      );

      // Execute request 1 to completion
      const completed = await coordinator.executeLookup(r1.dto.id, 'analyst-1', client);
      expect(completed.status).toBe('COMPLETED');

      // Request 2 for the same indicator is now allowed because previous is completed
      const r2 = await coordinator.createRequest(
        {
          analystId: 'analyst-2',
          idempotencyKey: 'key-new',
          indicator: 'hxxp://MALWARE.COM/',
        },
        client
      );

      client.release();
      expect(r2.dto.status).toBe('LEASED');
      expect(r2.dto.normalizedIndicator).toBe('malware.com');
    });
  });

  describe('4. Reservation, FIFO Queuing, and Expiry', () => {
    it('allocates queue order using monotonic database identity sequence', async () => {
      const client = await testPool.connect();
      await quotaService.ensureQuotaRow(client);

      const r1 = await client.query(
        `INSERT INTO enrichment_requests (analyst_id, idempotency_key, indicator, normalized_indicator, status)
         VALUES ('a1', 'k1', 'ind1.com', 'ind1.com', 'QUEUED') RETURNING queue_position;`
      );
      const r2 = await client.query(
        `INSERT INTO enrichment_requests (analyst_id, idempotency_key, indicator, normalized_indicator, status)
         VALUES ('a1', 'k2', 'ind2.com', 'ind2.com', 'QUEUED') RETURNING queue_position;`
      );

      client.release();
      const pos1 = Number(r1.rows[0].queue_position);
      const pos2 = Number(r2.rows[0].queue_position);
      expect(pos2).toBeGreaterThan(pos1);
    });

    it('rejects execution when the lease has expired', async () => {
      const client = await testPool.connect();
      await quotaService.ensureQuotaRow(client);

      // Create an already-expired lease
      const insertRes = await client.query(
        `INSERT INTO enrichment_requests (
           analyst_id, idempotency_key, indicator, normalized_indicator, status, lease_expires_at
         )
         VALUES ('a1', 'k1', 'threat.org', 'threat.org', 'LEASED', NOW() - INTERVAL '10 second')
         RETURNING id;`
      );
      const id = insertRes.rows[0].id;

      let err: any = null;
      try {
        await coordinator.executeLookup(id, 'a1', client);
      } catch (e) {
        err = e;
      }

      client.release();
      expect(err).not.toBeNull();
      expect(err.statusCode).toBe(410); // Lease expired
    });

    it('executes valid lease, consumes quota permanently, and attaches verdict', async () => {
      const client = await testPool.connect();

      const created = await coordinator.createRequest(
        {
          analystId: 'analyst-1',
          idempotencyKey: 'key-exec',
          indicator: 'c2.net',
        },
        client
      );

      expect(created.dto.status).toBe('LEASED');

      const completed = await coordinator.executeLookup(created.dto.id, 'analyst-1', client);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.verdict).toBeDefined();
      expect(['clean', 'suspicious', 'malicious']).toContain(completed.verdict?.verdict);

      // Check quota state: 0 reserved, 1 consumed, 9 available
      const quota = await quotaService.getTodayQuota(client);
      expect(quota.reservedCount).toBe(0);
      expect(quota.consumedCount).toBe(1);
      expect(quota.availableCount).toBe(9);

      // Idempotent re-execution: calling execute again returns same completed verdict without error
      const retryExec = await coordinator.executeLookup(created.dto.id, 'analyst-1', client);
      expect(retryExec.status).toBe('COMPLETED');
      expect(retryExec.verdict?.verdict).toBe(completed.verdict?.verdict);

      // Quota is NOT consumed twice!
      const quotaAfterRetry = await quotaService.getTodayQuota(client);
      expect(quotaAfterRetry.consumedCount).toBe(1);

      client.release();
    });
  });

  describe('5. Expiry and FIFO Queue Promotion', () => {
    it('releases expired reservation and promotes the oldest eligible queued request', async () => {
      const client = await testPool.connect();
      const today = getTodayDateString();
      await quotaService.ensureQuotaRow(client);

      // Artificially set max limit to 1 and reserved to 1
      await client.query('UPDATE daily_quotas SET max_limit = 1, reserved_count = 1 WHERE quota_date = $1', [today]);

      // Request 1: Expired lease
      const r1 = await client.query(
        `INSERT INTO enrichment_requests (analyst_id, idempotency_key, indicator, normalized_indicator, status, lease_expires_at)
         VALUES ('a1', 'k1', 'exp1.com', 'exp1.com', 'LEASED', NOW() - INTERVAL '5 second')
         RETURNING id;`
      );

      // Request 2: Oldest queued
      const r2 = await client.query(
        `INSERT INTO enrichment_requests (analyst_id, idempotency_key, indicator, normalized_indicator, status)
         VALUES ('a2', 'k2', 'queue1.com', 'queue1.com', 'QUEUED')
         RETURNING id;`
      );

      // Request 3: Newer queued
      const r3 = await client.query(
        `INSERT INTO enrichment_requests (analyst_id, idempotency_key, indicator, normalized_indicator, status)
         VALUES ('a3', 'k3', 'queue2.com', 'queue2.com', 'QUEUED')
         RETURNING id;`
      );

      // Run reconciliation
      const result = await coordinator.reconcileExpiredLeasesAndPromote(client);
      expect(result.expiredCount).toBe(1);
      expect(result.promotedCount).toBe(1);

      // Oldest (r2) should now be LEASED
      const checkR2 = await client.query('SELECT status FROM enrichment_requests WHERE id = $1', [r2.rows[0].id]);
      expect(checkR2.rows[0].status).toBe('LEASED');

      // Newer (r3) should still be QUEUED
      const checkR3 = await client.query('SELECT status FROM enrichment_requests WHERE id = $1', [r3.rows[0].id]);
      expect(checkR3.rows[0].status).toBe('QUEUED');

      client.release();
    });
  });

  describe('6. High Concurrency Invariant Protection (~200 Requests)', () => {
    it('maintains strict daily quota bound (reserved + consumed <= 10) under high load', async () => {
      await quotaService.ensureQuotaRow(testPool);

      const TOTAL_REQUESTS = 200;

      // Submit 200 concurrent requests
      const submissions = Array.from({ length: TOTAL_REQUESTS }, async (_, i) => {
        return await coordinator.createRequest({
          analystId: `analyst-${i}`,
          idempotencyKey: `key-${i}`,
          indicator: `indicator-${i}.com`,
        });
      });

      await Promise.all(submissions);

      // Verify final counts
      const quota = await quotaService.getTodayQuota(testPool);
      expect(quota.reservedCount + quota.consumedCount).toBeLessThanOrEqual(10);
      expect(quota.reservedCount).toBe(10);
      expect(quota.availableCount).toBe(0);

      const leasedCountRes = await testPool.query("SELECT COUNT(*)::int AS count FROM enrichment_requests WHERE status = 'LEASED'");
      expect(leasedCountRes.rows[0].count).toBe(10);

      const queuedCountRes = await testPool.query("SELECT COUNT(*)::int AS count FROM enrichment_requests WHERE status = 'QUEUED'");
      expect(queuedCountRes.rows[0].count).toBe(190);
    });
  });
});
