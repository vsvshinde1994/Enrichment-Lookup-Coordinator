# Enrichment Lookup Coordinator with Provider Quota

A production-grade, concurrency-safe full-stack threat intelligence coordination system built with **React**, **TypeScript**, **Vite**, **Node.js**, **Express**, and **PostgreSQL**.

---

## 🛡️ Project Overview & Problem Statement

External threat intelligence enrichment providers impose strict rate limits and daily lookups quotas. In enterprise Security Operations Centers (SOC), multiple analysts concurrently triage alerts containing indicators of compromise (IOCs) such as malicious domains, phishing URLs, IP addresses, and file hashes.

This coordinator mediates access to external threat providers by enforcing fair access, preventing quota waste, and ensuring mathematical correctness under high concurrency:

1. **Daily Quota Cap:** Enforce a strict daily quota (default: 10 lookups) for external threat intelligence providers.
2. **5-Minute Leases:** Enrichment requests reserve 1 quota unit for 5 minutes (`LEASED`).
3. **Execution & Consumption:** Lookups can only be executed while a lease is valid. Execution calls the external threat provider and permanently consumes the reserved quota unit (`COMPLETED`).
4. **Fair Expiry & Promotion:** Expired, unused leases release their reservation and automatically promote the oldest eligible queued request (`QUEUED` $\to$ `LEASED`).
5. **Idempotency:** Requests with the same `(analyst_id, idempotency_key)` return the existing request without creating duplicate reservations.
6. **Active Indicator Singularity:** The same normalized network indicator (domain, IP, URL, or hash) cannot have more than one active request (`QUEUED`, `LEASED`, or `EXECUTING`).
7. **FIFO Queuing:** When capacity is unavailable, excess requests enter a fair FIFO queue with monotonic ordering.
8. **High Concurrency Invariant Protection:** Under 200+ simultaneous requests, the daily quota can **never** be exceeded, and duplicate leases or executions are mathematically prevented at the database layer.
9. **Analyst Identification:** Analysts are identified via `analystId` supplied in client headers or request payload.
10. **Interactive SOC Dashboard:** Real-time visibility into remaining quota, request status, relative queue positions, active lease countdowns, a "Run Lookup" action button, and completed reputation verdicts.

---

## 💻 Tech Stack

- **Frontend:** React 18, TypeScript 5, Vite 6, Native CSS (cybersecurity dark theme, responsive, accessible).
- **Backend:** Node.js (v20/v22/v26), Express 4, TypeScript 5.
- **Database:** PostgreSQL (v14+ / v16 / v18), parameterized SQL queries, row-level locks (`SELECT ... FOR UPDATE`), partial unique indexes, check constraints.
- **Testing:** Vitest, `embedded-postgres` (PostgreSQL 18 native binary for real database integration testing).
- **Deployment:** Multi-stage Dockerfile, Docker Compose.

---

## 🏛️ Architecture & Concurrency Strategy

```
                          ┌─────────────────────────────────────────┐
                          │       React + TypeScript Dashboard      │
                          │ (Quota Summary, Countdown, Queue, Run)  │
                          └───────────────────┬─────────────────────┘
                                              │ HTTP / JSON
                                              ▼
                          ┌─────────────────────────────────────────┐
                          │         Express REST API Router         │
                          │      (/api/enrichments, /api/quota)     │
                          └───────────────────┬─────────────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
        ┌────────────────────────────┐                  ┌───────────────────────────┐
        │  LookupCoordinatorService  │                  │    LeaseReaper Worker     │
        │   • Atomic Quota Updates   │                  │   • Sweeps Stale Leases   │
        │   • FIFO Queue Promotion   │                  │   • Refunds Quota Slot    │
        │   • Non-Blocking 2-Phase   │                  │   • Multi-Worker Safe     │
        └─────────────┬──────────────┘                  └─────────────┬─────────────┘
                      │                                               │
                      └───────────────────────┬───────────────────────┘
                                              │ Parameterized SQL + Row Locks
                                              ▼
                          ┌─────────────────────────────────────────┐
                          │           PostgreSQL Database           │
                          │  • CHECK ((reserved + consumed) <= 10)  │
                          │  • Partial Unique Index (Active IOCs)   │
                          │  • Identity Monotonic FIFO Sequence     │
                          └─────────────────────────────────────────┘
```

### Key Technical Decisions

#### 1. PostgreSQL as Single Source of Truth
In-memory locks fail when applications are scaled across multiple containers or cluster worker instances. All quota limits and active states are enforced directly by PostgreSQL check constraints, atomic conditional updates, and row-level locks (`FOR UPDATE`).

#### 2. Atomic Conditional Allocation
Quota increments are never performed via naive application-level `if (reserved + consumed < 10)` checks (which create race conditions under concurrent requests). Instead, an atomic conditional update is evaluated by PostgreSQL:
```sql
UPDATE daily_quotas
SET reserved_count = reserved_count + 1, updated_at = NOW()
WHERE quota_date = $1 AND (reserved_count + consumed_count) < max_limit
RETURNING *;
```
If capacity is full, 0 rows are updated and the request atomically falls back to entering the FIFO queue.

#### 3. Database-Enforced Active Indicator Singularity
Application-level `SELECT ... WHERE ...` checks suffer from Time-of-Check to Time-of-Use (TOCTOU) races under parallel traffic. A PostgreSQL partial unique index guarantees active indicator singularity at the engine level:
```sql
CREATE UNIQUE INDEX uq_active_normalized_indicator
  ON enrichment_requests (normalized_indicator)
  WHERE status IN ('QUEUED', 'LEASED', 'EXECUTING');
```

#### 4. Non-Blocking Two-Phase Claim Pattern
External threat provider lookups require 100–250ms of network latency. **Holding database transactions open during external network calls is an anti-pattern** that leads to database connection pool starvation.
- **Phase 1 (Atomic Claim):** In a micro-query, transition request state:
  ```sql
  UPDATE enrichment_requests
  SET status = 'EXECUTING', execution_started_at = NOW()
  WHERE id = $1 AND analyst_id = $2 AND status = 'LEASED' AND lease_expires_at > NOW()
  RETURNING *;
  ```
- **Phase 2 (Invoke Provider):** Perform the mock provider network call **completely outside** of any DB transaction.
- **Phase 3 (Finalize):** Commit results and finalize quota consumption (`reserved_count - 1`, `consumed_count + 1`).
If two concurrent run calls arrive for the same request, exactly one claims `status = 'EXECUTING'`; the second is immediately rejected with `409 Conflict`.

#### 5. Lease Expiry & Queue Promotion
A background reaper worker sweeps expired leases every 3 seconds:
- Identifies leases where `status = 'LEASED' AND lease_expires_at <= NOW()`.
- Transitions them to `EXPIRED`.
- Refunds `reserved_count` on the original quota date.
- Promotes the oldest queued requests (`WHERE status = 'QUEUED' ORDER BY queue_position ASC`) into `LEASED` with a fresh 5-minute lease timer.
- Strict row locking (`SELECT quota_date FROM daily_quotas FOR UPDATE`) prevents deadlocks between multiple concurrent worker instances.

---

## 🗄️ Database Schema

### Table: `daily_quotas`
| Column | Type | Description |
| :--- | :--- | :--- |
| `quota_date` | `DATE PRIMARY KEY` | Quota date (e.g. `2026-10-31`) |
| `max_limit` | `INTEGER NOT NULL DEFAULT 10` | Daily limit |
| `reserved_count` | `INTEGER NOT NULL DEFAULT 0` | Active, unexpired 5-minute reservations |
| `consumed_count` | `INTEGER NOT NULL DEFAULT 0` | Executed, permanent lookups |
| `created_at` | `TIMESTAMPTZ` | Timestamp |
| `updated_at` | `TIMESTAMPTZ` | Timestamp |

**Constraint:**
```sql
CONSTRAINT quota_not_exceeded CHECK ((reserved_count + consumed_count) <= max_limit)
```

### Table: `enrichment_requests`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | Unique request identifier |
| `analyst_id` | `VARCHAR(128) NOT NULL` | Requesting analyst identifier |
| `idempotency_key` | `VARCHAR(256) NOT NULL` | Client idempotency token |
| `indicator` | `VARCHAR(512) NOT NULL` | Original indicator input |
| `normalized_indicator`| `VARCHAR(512) NOT NULL` | Refanged, canonical lowercase indicator |
| `status` | `VARCHAR(32) NOT NULL` | `QUEUED`, `LEASED`, `EXECUTING`, `COMPLETED`, `EXPIRED`, `FAILED` |
| `quota_date` | `DATE` | Associated quota date |
| `queue_position` | `BIGINT GENERATED ALWAYS AS IDENTITY` | Concurrency-safe monotonic FIFO sequence |
| `lease_acquired_at` | `TIMESTAMPTZ` | When lease was granted |
| `lease_expires_at` | `TIMESTAMPTZ` | Lease deadline (`+ INTERVAL '300 seconds'`) |
| `execution_started_at`| `TIMESTAMPTZ` | When execution claim started |
| `completed_at` | `TIMESTAMPTZ` | When execution finalized |
| `verdict` | `JSONB` | Reputation verdict (`clean`, `suspicious`, `malicious`, confidence) |
| `error_message` | `TEXT` | Failure message if execution failed |

---

## 🔌 API Endpoints

### 1. Request Enrichment (Reserve Lease or Queue)
- **Endpoint:** `POST /api/enrichments`
- **Headers:** `x-analyst-id: analyst-alice`
- **Request Body:**
  ```json
  {
    "indicator": "evil-c2[.]net",
    "analystId": "analyst-alice",
    "idempotencyKey": "req-uuid-12345"
  }
  ```
- **Response (`201 Created` on new reservation, `200 OK` on idempotent retry):**
  ```json
  {
    "id": "c110c966-2be7-4786-a82a-123f9df76a84",
    "analystId": "analyst-alice",
    "indicator": "evil-c2[.]net",
    "normalizedIndicator": "evil-c2.net",
    "status": "LEASED",
    "queuePosition": 1,
    "leaseAcquiredAt": "2026-10-31T15:00:00.000Z",
    "leaseExpiresAt": "2026-10-31T15:05:00.000Z",
    "leaseSecondsRemaining": 299,
    "verdict": null,
    "errorMessage": null
  }
  ```

### 2. Execute Lookup (Run Lookup while Lease is Valid)
- **Endpoint:** `POST /api/enrichments/:id/execute`
- **Headers:** `x-analyst-id: analyst-alice`
- **Response (`200 OK`):**
  ```json
  {
    "id": "c110c966-2be7-4786-a82a-123f9df76a84",
    "status": "COMPLETED",
    "verdict": {
      "verdict": "malicious",
      "confidence": 0.94,
      "details": "Indicator evil-c2[.]net flagged by threat feeds as active Command & Control (C2) / malware distribution infrastructure.",
      "analyzedAt": "2026-10-31T15:01:10.000Z",
      "provider": "CyberGuard-MockProvider-v1"
    }
  }
  ```

### 3. Get Request Status
- **Endpoint:** `GET /api/enrichments/:id`
- **Response (`200 OK`):** Returns request DTO including relative queue position or remaining seconds.

### 4. List Recent Requests
- **Endpoint:** `GET /api/enrichments?analystId=analyst-alice&limit=50`
- **Response (`200 OK`):** Array of recent enrichment requests.

### 5. Get Daily Quota Summary
- **Endpoint:** `GET /api/quota`
- **Response (`200 OK`):**
  ```json
  {
    "quotaDate": "2026-10-31",
    "maxLimit": 10,
    "reservedCount": 1,
    "consumedCount": 2,
    "availableCount": 7,
    "queuedCount": 0
  }
  ```

### 6. Trigger Manual Reconciliation Sweep
- **Endpoint:** `POST /api/enrichments/maintenance/reconcile`
- **Response (`200 OK`):** `{"expiredCount": 1, "promotedCount": 1}`

---

## 🚀 How to Run Locally

### Option A: Zero-Config Local Run (Embedded PostgreSQL Auto-Start)
The project includes automatic development database detection: if no PostgreSQL instance is running on port `5432`, the backend **automatically starts an embedded native PostgreSQL 18 server** on port `54332`.

```bash
# 1. Install dependencies
npm install
cd frontend && npm install && cd ..

# 2. Build the project
npm run build

# 3. Start the application
npm start
```
The application will be accessible at **`http://localhost:3000`**.

### Option B: Local Run with External PostgreSQL
1. Create a `.env` file:
   ```env
   PORT=3000
   DATABASE_URL=postgresql://postgres:password@localhost:5432/enrichment_coordinator
   DAILY_QUOTA_LIMIT=10
   LEASE_DURATION_SECONDS=300
   REAPER_INTERVAL_MS=3000
   NODE_ENV=development
   ```
2. Start the dev server:
   ```bash
   # Terminal 1: Backend with hot module reloading
   npm run dev:backend

   # Terminal 2: Frontend Vite dev server
   npm run dev:frontend
   ```

---

## 🧪 How to Run Automated Tests

The test suite validates concurrency safety against **real PostgreSQL instances** using `embedded-postgres`. In-memory mocks are not used for locking verification.

```bash
# Run all 29 automated tests (unit + real PostgreSQL integration)
npm test
```

### Test Coverage Overview:
- `tests/normalize.test.ts` (4 unit tests): Defanging `hxxp`, `[.]`, `(:)`, case normalization, whitespace trimming.
- `tests/coordinator.test.ts` (9 tests): Domain models, idempotency replaying, two-phase claims.
- `tests/businessRules.test.ts` (12 integration tests against Real PostgreSQL):
  1. Exactly 10 distinct requests obtain leases when quota is 10.
  2. $\ge 200$ concurrent distinct requests never result in $>10$ reservations or completions.
  3. Identical `(analyst_id, idempotency_key)` returns original request without reserving quota.
  4. Active normalized indicator uniqueness enforced by partial index.
  5. FIFO ordering enforced under capacity exhaustion.
  6. Permanent quota consumption on lookup completion.
  7. Expired leases rejected even before worker sweep.
  8. Expiry releases reservation and promotes oldest queued request.
  9. Concurrent worker sweeps do not double-release quota or duplicate leases.
  10. Concurrent execute calls for the same request do not execute provider twice.
  11. Database constraint errors roll back partial modifications atomically.
  12. Midnight date rollover protects quota period isolation.
- `tests/apiFlow.test.ts` (4 E2E HTTP integration tests): HTTP lifecycle, headers, and endpoints.

---

## 🐳 Deployment Instructions

### Docker & Docker Compose (Recommended)

1. **Deploy using Docker Compose:**
   ```bash
   docker compose up -d --build
   ```
   This will:
   - Start a `postgres:16-alpine` container with persistent storage volumes and healthchecks.
   - Build a multi-stage production container running the Node.js backend and serving the compiled Vite React frontend.
   - Run database migrations automatically on container boot.
   - Expose the app on `http://localhost:3000`.

2. **Verify Deployment:**
   ```bash
   curl http://localhost:3000/health
   # {"status":"ok","time":"..."}

   docker compose logs -f app
   ```

3. **Tear Down:**
   ```bash
   docker compose down -v
   ```

### Deploying to Cloud Platforms (Render, Fly.io, Railway, AWS ECS)
1. Provision a managed PostgreSQL instance and copy the `DATABASE_URL`.
2. Configure the required environment variables:
   - `PORT=3000`
   - `DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require`
   - `DAILY_QUOTA_LIMIT=10`
   - `LEASE_DURATION_SECONDS=300`
   - `REAPER_INTERVAL_MS=3000`
   - `NODE_ENV=production`
3. Deploy the Dockerfile. The application executes `runMigrations()` on startup automatically.

---

## ⚠️ Known Limitations

1. **Clustered In-Memory Clocks:** The system relies on database timestamps (`NOW()`) for lease expiry checks to avoid clock skew across distributed servers. However, client timers in the browser rely on the client's local clock to tick countdowns between 2.5s polling syncs.
2. **Fixed Provider Latency:** The mock provider simulates realistic network latency (100–250ms), but does not simulate provider network partitions or HTTP 504 timeouts.
3. **Identity Without Passwords:** Per requirement 10, analysts are identified by client-supplied `analystId` without password authentication.

---

## 🔮 What Would Be Improved with More Time

1. **Server-Sent Events (SSE) or WebSockets:** Replace 2.5-second adaptive polling with real-time push updates for immediate queue promotions and lease ticking.
2. **Rate Limiting per Analyst:** Add a sliding window rate limiter (e.g. max 3 requests/minute per analyst) to prevent a single analyst from consuming all 10 slots before colleagues can submit.
3. **Persistent Result Caching with TTL:** Cache completed verdicts for 24 hours so identical IOC queries within the same day don't consume additional quota units.
4. **Provider Fallback Circuit Breaker:** Implement an automated circuit breaker with exponential backoff if the external threat provider experiences consecutive failures.

---

## 🔒 Security & Domain Assumptions

1. **Authentication Out of Scope:** In accordance with the prompt specification, authentication is not implemented. `analystId` is passed via `x-analyst-id` header or body.
2. **Indicator Normalization:** Normalization strips protocols (`http://`, `hxxps://`), refangs brackets (`[.]`, `(:)`), and converts to lowercase. It assumes that path variations on the same domain or FQDN represent distinct indicators if path parameters are present.
3. **UTC Quota Rollover:** Quota periods are tied to `CURRENT_DATE` in UTC (`YYYY-MM-DD`). A lease reserved at 23:58 UTC and executed at 00:01 UTC consumes quota from its original reservation date, preventing quota rollover corruption.

---

## 📊 Build Report & Metrics

- **Build Start Time:** `2026-10-29 23:14:52 IST` (`2026-10-29T17:44:52Z`)
- **Backend & Real PostgreSQL Tests Complete:** `2026-10-29 23:50:00 IST` (~35 minutes)
- **Full-Stack Working App Complete (Frontend + Backend):** `2026-10-30 00:09:50 IST` (~55 minutes total time)
- **Tokens Consumed:**
  - Total Input Tokens: `2,749,853` (~2.75M)
  - Total Output Tokens: `233,262` (~233k)
  - Total Cache Read Tokens: `45,426,954` (~45.4M)
