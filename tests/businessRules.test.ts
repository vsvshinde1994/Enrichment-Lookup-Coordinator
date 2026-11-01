import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import {
  startRealPostgres,
  cleanDatabase,
  stopRealPostgres,
} from './realPostgresHarness.js';
import {
  LookupCoordinatorService,
  DuplicateActiveIndicatorError,
  AppError,
} from '../src/services/lookupCoordinator.js';
import { QuotaService, getTodayDateString } from '../src/services/quotaService.js';
import { MockProvider } from '../src/services/mockProvider.js';

class ControllableMockProvider extends MockProvider {
  public callCount = 0;
  public delayMs = 30;

  async lookup(indicator: string) {
    this.callCount++;
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    return {
      verdict: 'clean' as const,
      confidence: 0.99,
      details: 'Verified by controllable mock provider',
      analyzedAt: new Date().toISOString(),
      provider: 'ControllableMockProvider',
    };
  }

  reset() {
    this.callCount = 0;
  }
}

describe('Business Rules Test Suite against Real PostgreSQL', () => {
  let pool: Pool;
  let mock: ControllableMockProvider;
  let coordinator: LookupCoordinatorService;
  let quotaService: QuotaService;

  beforeAll(async () => {
    pool = await startRealPostgres();
    mock = new ControllableMockProvider();
    coordinator = new LookupCoordinatorService(pool, mock);
    quotaService = new QuotaService();
  }, 30000);

  afterAll(async () => {
    await stopRealPostgres();
  });

  beforeEach(async () => {
    await cleanDatabase();
    mock.reset();
  });

  // Scenario 1
  it('1. Exactly 10 distinct requests can obtain leases when daily quota is 10 and no units have been consumed', async () => {
    const results = [];
    for (let i = 1; i <= 12; i++) {
      const res = await coordinator.createRequest({
        analystId: `analyst-${i}`,
        idempotencyKey: `key-${i}`,
        indicator: `indicator-${i}.com`,
      });
      results.push(res);
    }

    const leased = results.filter((r) => r.dto.status === 'LEASED');
    const queued = results.filter((r) => r.dto.status === 'QUEUED');

    expect(leased.length).toBe(10);
    expect(queued.length).toBe(2);

    const quota = await quotaService.getTodayQuota(pool);
    expect(quota.reservedCount).toBe(10);
    expect(quota.consumedCount).toBe(0);
    expect(quota.availableCount).toBe(0);
  });

  // Scenario 2
  it('2. At least 200 concurrent distinct requests never result in more than 10 simultaneous reservations or more than 10 completed lookups', async () => {
    const TOTAL_CONCURRENT = 200;

    // Fire 200 distinct requests concurrently across database connections
    const createPromises = Array.from({ length: TOTAL_CONCURRENT }, (_, i) =>
      coordinator.createRequest({
        analystId: `analyst-concur-${i}`,
        idempotencyKey: `idemp-concur-${i}`,
        indicator: `high-concurrency-ind-${i}.org`,
      })
    );

    const createdResults = await Promise.all(createPromises);

    const leasedResults = createdResults.filter((r) => r.dto.status === 'LEASED');
    const queuedResults = createdResults.filter((r) => r.dto.status === 'QUEUED');

    expect(leasedResults.length).toBe(10);
    expect(queuedResults.length).toBe(190);

    const midQuota = await quotaService.getTodayQuota(pool);
    expect(midQuota.reservedCount).toBe(10);
    expect(midQuota.consumedCount).toBe(0);
    expect(midQuota.reservedCount + midQuota.consumedCount).toBeLessThanOrEqual(10);

    // Attempt to execute all 10 leased requests concurrently
    const executePromises = leasedResults.map((r) =>
      coordinator.executeLookup(r.dto.id, r.dto.analystId)
    );
    const executedResults = await Promise.all(executePromises);

    expect(executedResults.every((r) => r.status === 'COMPLETED')).toBe(true);

    const finalQuota = await quotaService.getTodayQuota(pool);
    expect(finalQuota.reservedCount).toBe(0);
    expect(finalQuota.consumedCount).toBe(10);
    expect(finalQuota.availableCount).toBe(0);
    expect(mock.callCount).toBe(10);

    // Any queued request execution attempt should fail
    await expect(
      coordinator.executeLookup(queuedResults[0].dto.id, queuedResults[0].dto.analystId)
    ).rejects.toThrowError(AppError);
  });

  // Scenario 3
  it('3. Repeating the same request with the same idempotency key returns the original request and does not reserve additional quota', async () => {
    const original = await coordinator.createRequest({
      analystId: 'analyst-alpha',
      idempotencyKey: 'idemp-duplicate-test',
      indicator: 'example.com',
    });

    expect(original.isRetry).toBe(false);
    expect(original.dto.status).toBe('LEASED');

    // Replay with identical key
    const replay = await coordinator.createRequest({
      analystId: 'analyst-alpha',
      idempotencyKey: 'idemp-duplicate-test',
      indicator: 'example.com',
    });

    expect(replay.isRetry).toBe(true);
    expect(replay.dto.id).toBe(original.dto.id);

    const quota = await quotaService.getTodayQuota(pool);
    expect(quota.reservedCount).toBe(1); // Reserved count must NOT double increment
  });

  // Scenario 4
  it('4. Different idempotency keys for the same normalised active indicator do not create separate active requests', async () => {
    // Submit defanged active request
    const first = await coordinator.createRequest({
      analystId: 'analyst-1',
      idempotencyKey: 'key-first',
      indicator: 'hxxps://MALICIOUS-C2[.]COM:8080/path///',
    });

    expect(first.dto.status).toBe('LEASED');
    expect(first.dto.normalizedIndicator).toBe('malicious-c2.com:8080/path');

    // Submit different key with raw equivalent indicator for different analyst
    await expect(
      coordinator.createRequest({
        analystId: 'analyst-2',
        idempotencyKey: 'key-second',
        indicator: 'https://malicious-c2.com:8080/path',
      })
    ).rejects.toThrowError(DuplicateActiveIndicatorError);

    // Quota should only be 1
    const quota = await quotaService.getTodayQuota(pool);
    expect(quota.reservedCount).toBe(1);
  });

  // Scenario 5
  it('5. When capacity is exhausted, requests enter the queue in FIFO order', async () => {
    // Fill 10 capacity slots
    for (let i = 1; i <= 10; i++) {
      await coordinator.createRequest({
        analystId: `filler-${i}`,
        idempotencyKey: `fill-key-${i}`,
        indicator: `fill-${i}.net`,
      });
    }

    // Next 3 requests must queue in strictly increasing order
    const q1 = await coordinator.createRequest({
      analystId: 'user-a',
      idempotencyKey: 'qa-key',
      indicator: 'queued-a.com',
    });

    const q2 = await coordinator.createRequest({
      analystId: 'user-b',
      idempotencyKey: 'qb-key',
      indicator: 'queued-b.com',
    });

    const q3 = await coordinator.createRequest({
      analystId: 'user-c',
      idempotencyKey: 'qc-key',
      indicator: 'queued-c.com',
    });

    expect(q1.dto.status).toBe('QUEUED');
    expect(q2.dto.status).toBe('QUEUED');
    expect(q3.dto.status).toBe('QUEUED');

    expect(q1.dto.queuePosition!).toBeLessThan(q2.dto.queuePosition!);
    expect(q2.dto.queuePosition!).toBeLessThan(q3.dto.queuePosition!);

    // Relative positions
    expect(q1.dto.relativeQueuePosition).toBe(1);
    expect(q2.dto.relativeQueuePosition).toBe(2);
    expect(q3.dto.relativeQueuePosition).toBe(3);
  });

  // Scenario 6
  it('6. Completing a lookup consumes its reserved unit permanently for the current quota period', async () => {
    const created = await coordinator.createRequest({
      analystId: 'analyst-exec',
      idempotencyKey: 'exec-test-key',
      indicator: 'target-site.com',
    });

    const preQuota = await quotaService.getTodayQuota(pool);
    expect(preQuota.reservedCount).toBe(1);
    expect(preQuota.consumedCount).toBe(0);

    const completed = await coordinator.executeLookup(created.dto.id, 'analyst-exec');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.verdict).toBeDefined();

    const postQuota = await quotaService.getTodayQuota(pool);
    expect(postQuota.reservedCount).toBe(0);
    expect(postQuota.consumedCount).toBe(1);
    expect(postQuota.availableCount).toBe(9);
  });

  // Scenario 7
  it('7. Expired leases are rejected even when the expiry worker has not run yet', async () => {
    // Manually insert an expired lease directly in PostgreSQL without running any reaper worker
    const insertRes = await pool.query<{ id: string }>(
      `INSERT INTO enrichment_requests (
         analyst_id, idempotency_key, indicator, normalized_indicator,
         status, lease_acquired_at, lease_expires_at
       )
       VALUES (
         'analyst-lazy', 'key-lazy-expired', 'expired-target.com', 'expired-target.com',
         'LEASED', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes'
       )
       RETURNING id;`
    );
    const expiredId = insertRes.rows[0].id;

    // Execution must be rejected with 410 Gone
    let error: any = null;
    try {
      await coordinator.executeLookup(expiredId, 'analyst-lazy');
    } catch (err) {
      error = err;
    }

    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(410);
    expect(mock.callCount).toBe(0); // Provider was NEVER called
  });

  // Scenario 8
  it('8. Expiry releases a reservation exactly once and promotes the oldest eligible queued request', async () => {
    // Fill quota to 10
    const leases = [];
    for (let i = 1; i <= 10; i++) {
      const res = await coordinator.createRequest({
        analystId: `user-${i}`,
        idempotencyKey: `key-${i}`,
        indicator: `quota-${i}.com`,
      });
      leases.push(res);
    }

    // Add 2 queued requests
    const qOldest = await coordinator.createRequest({
      analystId: 'queued-oldest',
      idempotencyKey: 'q-old',
      indicator: 'oldest.com',
    });

    const qNewer = await coordinator.createRequest({
      analystId: 'queued-newer',
      idempotencyKey: 'q-new',
      indicator: 'newer.com',
    });

    // Artificially expire the 1st lease
    await pool.query(
      `UPDATE enrichment_requests
       SET lease_expires_at = NOW() - INTERVAL '1 minute'
       WHERE id = $1;`,
      [leases[0].dto.id]
    );

    // Run reconciliation
    const result = await coordinator.reconcileExpiredLeasesAndPromote();
    expect(result.expiredCount).toBe(1);
    expect(result.promotedCount).toBe(1);

    // Oldest should now be LEASED with a fresh 5-minute lease
    const promotedCheck = await coordinator.getRequestById(qOldest.dto.id);
    expect(promotedCheck.status).toBe('LEASED');
    expect(promotedCheck.leaseSecondsRemaining).toBeGreaterThan(250);

    // Newer should still be QUEUED
    const remainingCheck = await coordinator.getRequestById(qNewer.dto.id);
    expect(remainingCheck.status).toBe('QUEUED');
    expect(remainingCheck.relativeQueuePosition).toBe(1);

    // Total reserved count remains exactly 10
    const quota = await quotaService.getTodayQuota(pool);
    expect(quota.reservedCount).toBe(10);
  });

  // Scenario 9
  it('9. Running the expiry worker repeatedly or concurrently does not double-release quota or promote duplicate leases', async () => {
    // Ensure daily quota max_limit is 1 for this test
    const today = getTodayDateString();
    await pool.query(
      `INSERT INTO daily_quotas (quota_date, max_limit, reserved_count, consumed_count)
       VALUES ($1, 1, 0, 0)
       ON CONFLICT (quota_date) DO UPDATE SET max_limit = 1;`,
      [today]
    );

    const r1 = await coordinator.createRequest({
      analystId: 'u1',
      idempotencyKey: 'k1',
      indicator: 'lease1.com',
    });

    const r2 = await coordinator.createRequest({
      analystId: 'u2',
      idempotencyKey: 'k2',
      indicator: 'queue2.com',
    });

    expect(r1.dto.status).toBe('LEASED');
    expect(r2.dto.status).toBe('QUEUED');

    // Expire r1
    await pool.query(`UPDATE enrichment_requests SET lease_expires_at = NOW() - INTERVAL '10 seconds' WHERE id = $1;`, [r1.dto.id]);

    // Fire 5 concurrent reconciliation sweeps simulating multi-worker cluster
    const sweepResults = await Promise.all([
      coordinator.reconcileExpiredLeasesAndPromote(),
      coordinator.reconcileExpiredLeasesAndPromote(),
      coordinator.reconcileExpiredLeasesAndPromote(),
      coordinator.reconcileExpiredLeasesAndPromote(),
      coordinator.reconcileExpiredLeasesAndPromote(),
    ]);

    const totalExpired = sweepResults.reduce((acc, r) => acc + r.expiredCount, 0);
    const totalPromoted = sweepResults.reduce((acc, r) => acc + r.promotedCount, 0);

    expect(totalExpired).toBe(1);
    expect(totalPromoted).toBe(1);

    // Quota reserved must be exactly 1, not underflowed or negative
    const quota = await quotaService.getTodayQuota(pool);
    expect(quota.reservedCount).toBe(1);
    expect(quota.consumedCount).toBe(0);
  });

  // Scenario 10
  it('10. Two concurrent Run Lookup calls for the same request do not execute the provider twice', async () => {
    const res = await coordinator.createRequest({
      analystId: 'analyst-race',
      idempotencyKey: 'race-key',
      indicator: 'double-run.com',
    });

    mock.delayMs = 100; // Artificially delay external provider call

    // Fire two execute calls simultaneously
    const [call1, call2] = await Promise.allSettled([
      coordinator.executeLookup(res.dto.id, 'analyst-race'),
      coordinator.executeLookup(res.dto.id, 'analyst-race'),
    ]);

    // At least one must succeed
    const successful = [call1, call2].filter((c) => c.status === 'fulfilled');
    expect(successful.length).toBeGreaterThanOrEqual(1);

    // The other was either rejected with 409 (execution in progress) or received idempotent completion
    if (call1.status === 'rejected') {
      expect((call1.reason as AppError).statusCode).toBe(409);
    }
    if (call2.status === 'rejected') {
      expect((call2.reason as AppError).statusCode).toBe(409);
    }

    // Crucial assertion: external provider was called EXACTLY ONCE
    expect(mock.callCount).toBe(1);

    // Daily quota consumed exactly once
    const quota = await quotaService.getTodayQuota(pool);
    expect(quota.consumedCount).toBe(1);
    expect(quota.reservedCount).toBe(0);
  });

  // Scenario 11
  it('11. A database error rolls back partial changes', async () => {
    // Ensure today's quota row exists first
    const today = getTodayDateString();
    await quotaService.ensureQuotaRow(pool, today);

    const client = await pool.connect();
    await client.query('BEGIN');

    // Partial write 1: update quota to 5
    await client.query(`UPDATE daily_quotas SET reserved_count = 5 WHERE quota_date = $1;`, [today]);

    // Partial write 2: intentional failure (violates CHECK (max_limit >= 0))
    let failed = false;
    try {
      await client.query(`UPDATE daily_quotas SET max_limit = -1 WHERE quota_date = $1;`, [today]);
    } catch {
      failed = true;
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(failed).toBe(true);

    // Verify rollback restored initial state (reserved_count remains 0)
    const quota = await quotaService.getTodayQuota(pool);
    expect(quota.maxLimit).toBe(10);
    expect(quota.reservedCount).toBe(0);
  });

  // Scenario 12
  it('12. Requests around a daily quota reset cannot use the wrong quota period', async () => {
    const YESTERDAY = '2026-10-28';
    const TODAY = '2026-10-29';

    // 1. Initialize Yesterday with 1 reservation and 9 consumed lookups (capacity exhausted)
    await pool.query(
      `INSERT INTO daily_quotas (quota_date, max_limit, reserved_count, consumed_count)
       VALUES ($1, 10, 1, 9);`,
      [YESTERDAY]
    );

    // 2. Create a request leased yesterday that expires today
    const resYest = await pool.query<{ id: string }>(
      `INSERT INTO enrichment_requests (
         analyst_id, idempotency_key, indicator, normalized_indicator,
         status, quota_date, lease_acquired_at, lease_expires_at
       )
       VALUES ('analyst-yest', 'key-yest', 'yest.com', 'yest.com', 'LEASED', $1, NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '10 minutes')
       RETURNING id;`,
      [YESTERDAY]
    );
    const leaseId = resYest.rows[0].id;

    // 3. Execution of yesterday's lease completes now
    const completed = await coordinator.executeLookup(leaseId, 'analyst-yest');
    expect(completed.status).toBe('COMPLETED');

    // 4. Verify yesterday's consumed count incremented to 10 and reserved dropped to 0
    const quotaYest = await quotaService.getTodayQuota(pool, YESTERDAY);
    expect(quotaYest.reservedCount).toBe(0);
    expect(quotaYest.consumedCount).toBe(10);
    expect(quotaYest.availableCount).toBe(0);

    // 5. Verify TODAY's quota has NOT been touched or decremented (still 10 fresh units available)
    const quotaToday = await quotaService.getTodayQuota(pool, TODAY);
    expect(quotaToday.reservedCount).toBe(0);
    expect(quotaToday.consumedCount).toBe(0);
    expect(quotaToday.availableCount).toBe(10);

    // 6. Today can successfully lease 10 brand new requests without being blocked by yesterday's limit
    for (let i = 1; i <= 10; i++) {
      const todayReq = await coordinator.createRequest(
        {
          analystId: `today-analyst-${i}`,
          idempotencyKey: `today-key-${i}`,
          indicator: `today-ind-${i}.com`,
        },
        undefined,
        TODAY
      );
      expect(todayReq.dto.status).toBe('LEASED');
    }

    const postTodayQuota = await quotaService.getTodayQuota(pool, TODAY);
    expect(postTodayQuota.reservedCount).toBe(10);
    expect(postTodayQuota.consumedCount).toBe(0);
    expect(postTodayQuota.availableCount).toBe(0);
  });
});
