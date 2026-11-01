import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import http from 'http';
import { app } from '../src/app.js';
import {
  startRealPostgres,
  cleanDatabase,
  stopRealPostgres,
} from './realPostgresHarness.js';
import { getTodayDateString } from '../src/services/quotaService.js';
import { setPool } from '../src/config/db.js';

describe('End-to-End API Flow with Real PostgreSQL', () => {
  let pool: Pool;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    pool = await startRealPostgres();
    setPool(pool);

    // Start Express server on ephemeral port
    server = app.listen(0);
    const addr = server.address();
    if (typeof addr === 'object' && addr) {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }
  }, 30000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await stopRealPostgres();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  it('1. GET /api/quota returns all 5 quota metrics', async () => {
    const res = await fetch(`${baseUrl}/api/quota`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('quotaDate');
    expect(body.maxLimit).toBe(10);
    expect(body.availableCount).toBe(10);
    expect(body.reservedCount).toBe(0);
    expect(body.consumedCount).toBe(0);
    expect(body.queuedCount).toBe(0);
  });

  it('2. POST /api/enrichments reserves a lease and respects Idempotency-Key headers', async () => {
    const analystId = 'analyst-alice';
    const idempotencyKey = 'unique-key-001';
    const indicator = 'evil-c2[.]net';

    // 1st request with idempotency key
    const res1 = await fetch(`${baseUrl}/api/enrichments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-analyst-id': analystId,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ indicator }),
    });

    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.status).toBe('LEASED');
    expect(body1.normalizedIndicator).toBe('evil-c2.net');
    expect(body1.leaseExpiresAt).toBeTruthy();
    expect(body1.leaseSecondsRemaining).toBeGreaterThan(290);

    // Verify quota updated: 1 reserved, 9 available
    const quotaRes1 = await fetch(`${baseUrl}/api/quota`);
    const quota1 = await quotaRes1.json();
    expect(quota1.reservedCount).toBe(1);
    expect(quota1.availableCount).toBe(9);

    // 2nd request: EXACT SAME (analyst_id, Idempotency-Key)
    const res2 = await fetch(`${baseUrl}/api/enrichments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-analyst-id': analystId,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ indicator: 'evil-c2[.]net' }),
    });

    // Idempotent retry returns HTTP 200 with the exact same request ID
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.id).toBe(body1.id);

    // Verify quota NOT double-counted: reserved count remains 1
    const quotaRes2 = await fetch(`${baseUrl}/api/quota`);
    const quota2 = await quotaRes2.json();
    expect(quota2.reservedCount).toBe(1);
    expect(quota2.availableCount).toBe(9);
  });

  it('3. POST /api/enrichments/:id/execute runs lookup and consumes quota unit', async () => {
    // Create lease
    const createRes = await fetch(`${baseUrl}/api/enrichments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-analyst-id': 'analyst-bob',
        'Idempotency-Key': 'key-bob-1',
      },
      body: JSON.stringify({ indicator: 'suspicious-domain.org' }),
    });
    const created = await createRes.json();
    expect(created.status).toBe('LEASED');

    // Execute lookup
    const execRes = await fetch(`${baseUrl}/api/enrichments/${created.id}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-analyst-id': 'analyst-bob',
      },
    });

    expect(execRes.status).toBe(200);
    const executed = await execRes.json();
    expect(executed.status).toBe('COMPLETED');
    expect(executed.verdict).toBeTruthy();
    expect(['clean', 'suspicious', 'malicious']).toContain(executed.verdict.verdict);
    expect(executed.verdict.confidence).toBeGreaterThanOrEqual(0.65);

    // Verify quota consumption: reserved drops to 0, consumed becomes 1, available is 9
    const quotaRes = await fetch(`${baseUrl}/api/quota`);
    const quota = await quotaRes.json();
    expect(quota.reservedCount).toBe(0);
    expect(quota.consumedCount).toBe(1);
    expect(quota.availableCount).toBe(9);
  });

  it('4. FIFO Queue transition and promotion on expiry', async () => {
    // Set daily quota limit to 2 for this test
    const today = getTodayDateString();
    await pool.query(
      `INSERT INTO daily_quotas (quota_date, max_limit, reserved_count, consumed_count)
       VALUES ($1, 2, 0, 0)
       ON CONFLICT (quota_date) DO UPDATE SET max_limit = 2;`,
      [today]
    );

    // 1st request -> LEASED
    const r1Res = await fetch(`${baseUrl}/api/enrichments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-analyst-id': 'u1', 'Idempotency-Key': 'k1' },
      body: JSON.stringify({ indicator: 'ind-1.com' }),
    });
    const r1 = await r1Res.json();
    expect(r1.status).toBe('LEASED');

    // 2nd request -> LEASED
    const r2Res = await fetch(`${baseUrl}/api/enrichments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-analyst-id': 'u2', 'Idempotency-Key': 'k2' },
      body: JSON.stringify({ indicator: 'ind-2.com' }),
    });
    const r2 = await r2Res.json();
    expect(r2.status).toBe('LEASED');

    // 3rd request -> QUEUED (FIFO #1)
    const r3Res = await fetch(`${baseUrl}/api/enrichments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-analyst-id': 'u3', 'Idempotency-Key': 'k3' },
      body: JSON.stringify({ indicator: 'ind-3.com' }),
    });
    const r3 = await r3Res.json();
    expect(r3.status).toBe('QUEUED');
    expect(r3.relativeQueuePosition).toBe(1);

    // Quota summary should show 1 queued request
    const quotaRes = await fetch(`${baseUrl}/api/quota`);
    const quota = await quotaRes.json();
    expect(quota.queuedCount).toBe(1);
    expect(quota.availableCount).toBe(0);
    expect(quota.reservedCount).toBe(2);

    // Expire r1
    await pool.query(
      `UPDATE enrichment_requests SET lease_expires_at = NOW() - INTERVAL '5 seconds' WHERE id = $1;`,
      [r1.id]
    );

    // Trigger reconciliation endpoint
    const sweepRes = await fetch(`${baseUrl}/api/enrichments/maintenance/reconcile`, {
      method: 'POST',
    });
    expect(sweepRes.status).toBe(200);
    const sweep = await sweepRes.json();
    expect(sweep.expiredCount).toBe(1);
    expect(sweep.promotedCount).toBe(1);

    // Verify r3 was promoted to LEASED
    const checkR3Res = await fetch(`${baseUrl}/api/enrichments/${r3.id}`);
    const r3Updated = await checkR3Res.json();
    expect(r3Updated.status).toBe('LEASED');
    expect(r3Updated.leaseSecondsRemaining).toBeGreaterThan(290);
  });
});
