# Prompts History

This document contains the complete chronological record of user prompts provided to the AI coding agent during the design, implementation, testing, debugging, and refinement of the **Enrichment Lookup Coordinator with Provider Quota**.

---

### Prompt 1: Architecture, State Machine & Schema Design
**Timestamp:** `2026-10-29T17:44:52Z` (Local: `2026-10-29 23:14:52 IST`)

```
I am building a full-stack engineering assessment called "Enrichment Lookup Coordinator with Provider Quota" for a cybersecurity company.

Tech stack:
- Frontend: React, TypeScript, Vite
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL
- Testing: Vitest or Jest, plus integration tests against PostgreSQL

Requirements:
1. Start with a daily provider quota of 10 lookups.
2. Requesting an enrichment reserves one available quota unit for 5 minutes.
3. A client can run a lookup only while its lease is valid. Running it calls a mock provider and permanently consumes the reserved unit.
4. An expired, unused lease releases its reservation and allows the oldest eligible queued request to be promoted.
5. Requests with the same idempotency key must not create duplicate reservations.
6. The same normalized indicator must not have more than one active request, where active means queued or leased.
7. When capacity is unavailable, requests enter a FIFO queue.
8. Support roughly 200 simultaneous requests without exceeding the daily quota.
9. The UI must show remaining quota, request status, queue position, lease countdown, a Run Lookup button, and the completed reputation verdict.
10. Identify the analyst by an analystId supplied by the client. Authentication is out of scope.

Before writing code, produce:
- A concise architecture and request lifecycle.
- A state machine for queued, leased, completed, expired, and failed requests.
- A PostgreSQL schema for daily quota, lookup requests/leases, and queue ordering.
- The transaction and locking strategy for reservation, execution, expiry, and queue promotion.
- A list of invariants and failure scenarios.
- A prioritised implementation plan that fits a two-hour time limit.

Important:
- PostgreSQL is the source of truth.
- Do not rely on in-memory locks for correctness.
- Do not decrement quota outside a transaction.
- Explain how retries, duplicate indicators, and concurrent requests are handled.
- Keep the implementation small and explainable.
- Do not generate the entire application yet. Identify ambiguous requirements and state reasonable assumptions first.
```

---

### Prompt 2: Backend Implementation
**Timestamp:** `2026-10-29T17:46:21Z` (Local: `2026-10-29 23:16:21 IST`)

```
Implement the backend for the Enrichment Lookup Coordinator based on the architecture we agreed on.

Use Node.js, Express, TypeScript, PostgreSQL, and parameterized SQL queries.

Create:
- Database migrations or schema.sql.
- Database connection and configuration.
- Typed lookup domain models.
- A quota service and lookup coordinator service.
- An Express API with request, run, status, and quota endpoints.
- A mock provider that returns a random verdict from clean, suspicious, and malicious.
- A worker or scheduled process that expires unused leases and promotes queued requests.

Concurrency and correctness requirements:
1. Initialise the daily quota to 10 in a concurrency-safe, idempotent way.
2. Make reservation and queue promotion transactional. Use PostgreSQL row-level locks and a consistent lock order.
3. Ensure that concurrent requests cannot reserve more units than the quota.
4. Persist idempotency keys with a unique constraint and return the existing request for a retry.
5. Normalise indicators before checking uniqueness. Prevent duplicate active requests for the same indicator using database-enforced constraints where practical.
6. Allocate queue order using a database-generated sequence or another concurrency-safe FIFO mechanism.
7. Store lease expiry as a database timestamp. Reject execution when the lease has expired, even if the worker has not yet processed it.
8. Make Run Lookup idempotent. Concurrent run requests for the same lease must not invoke the mock provider more than once or consume quota twice.
9. Never hold a database transaction open while making a potentially slow provider call. Explain and implement an appropriate claim/processing strategy.
10. On expiry, release the reservation exactly once and promote the oldest eligible queued request.
11. Make expiry processing safe to run repeatedly and from multiple worker instances.
12. Handle database errors with rollback and meaningful HTTP responses.

First provide the file tree, then implement the files. Include npm scripts, environment variable validation, and SQL migrations. Keep the design minimal and explain any trade-offs. Do not claim the system is concurrency-safe unless the implementation and tests support that claim.
```

---

### Prompt 3: Backend Review & 12 Automated Business Rule Tests against Real PostgreSQL
**Timestamp:** `2026-10-29T17:48:47Z` (Local: `2026-10-29 23:18:47 IST`)

```
Review the backend implementation and write automated tests for its business rules. Use a real PostgreSQL test database for concurrency and transaction tests; mocks alone are insufficient for validating database locking.

Cover these scenarios:
1. Exactly 10 distinct requests can obtain leases when the daily quota is 10 and no units have been consumed.
2. At least 200 concurrent distinct requests never result in more than 10 simultaneous reservations or more than 10 completed provider lookups for that quota.
3. Repeating the same request with the same idempotency key returns the original request and does not reserve additional quota.
4. Different idempotency keys for the same normalised active indicator do not create separate active requests.
5. When capacity is exhausted, requests enter the queue in FIFO order.
6. Completing a lookup consumes its reserved unit permanently for the current quota period.
7. Expired leases are rejected even when the expiry worker has not run yet.
8. Expiry releases a reservation exactly once and promotes the oldest eligible queued request.
9. Running the expiry worker repeatedly or concurrently does not double-release quota or promote duplicate leases.
10. Two concurrent Run Lookup calls for the same request do not execute the provider twice.
11. A database error rolls back partial changes.
12. Requests around a daily quota reset cannot use the wrong quota period.

Use deterministic clocks and a controllable mock provider where practical. Clean up test data between cases. Run the tests and report actual results. Fix any failures caused by the implementation. Do not weaken assertions merely to make the suite pass.
```

---

### Prompt 4: React, TypeScript, and Vite Frontend Dashboard Implementation
**Timestamp:** `2026-10-29T18:30:40Z` (Local: `2026-10-30 00:00:40 IST`)

```
Implement the frontend for the Enrichment Lookup Coordinator using React, TypeScript, and Vite.

Build a clean, professional cybersecurity analyst dashboard with:
- A daily quota summary showing total quota, remaining available quota, active leases, consumed units, and queued requests.
- An indicator input with validation for an IP address, domain, or file hash.
- An analyst ID input or a clearly documented development default.
- A Request Enrichment button that sends a unique Idempotency-Key header for each new user action.
- A lookup status panel displaying queued status and position, lease expiry countdown, a Run Lookup button for valid leases, expired status, and completed reputation verdict.
- A clear loading, error, empty, and retry state.
- A list of recent requests so multiple queued and active requests can be observed.

Implementation requirements:
1. Use typed API clients and shared TypeScript interfaces.
2. Poll the backend for status and quota updates; stop polling when no longer necessary.
3. Derive the lease countdown from the server-provided expiresAt timestamp, not from a timer that assumes the lease always starts at the moment the page renders.
4. Disable Run Lookup when the lease is expired or the request is in an invalid state, but enforce all rules on the server too.
5. Prevent duplicate submissions caused by double-clicks without treating UI safeguards as the idempotency guarantee.
6. Display API errors clearly and allow safe retries.
7. Clean up polling timers when components unmount.
8. Do not simulate backend success with local-only state.
9. Keep dependencies minimal and ensure keyboard accessibility.

Implement the pages/components, API client, types, and styling. Connect them to the actual backend endpoints and verify the full request-to-completion flow.
```

---

### Prompt 15: Cloud Deployment Guidance
**Timestamp:** `2026-11-01T15:14:00Z` (Local: `2026-11-01 20:44:00 IST`)

```
help me deploy this application on cloud
```

---

### Prompt 16: Separate Commits & Granular Git History
**Timestamp:** `2026-11-01T15:19:44Z` (Local: `2026-11-01 20:49:44 IST`)

```
can you give me seperate commits as mentioned in the requirements and files to commit with each of them .
```

---

### Prompt 17: Remote GitHub Repository Integration
**Timestamp:** `2026-11-01T15:24:38Z` (Local: `2026-11-01 20:54:38 IST`)

```
https://github.com/vsvshinde1994/Enrichment-Lookup-Coordinator
```

---

### Prompt 18: Implementation Plan (PLAN.md)
**Timestamp:** `2026-11-01T15:50:49Z` (Local: `2026-11-01 21:20:49 IST`)

```
add plan.md file as well showing that I have created a plan first before implementanting the actual assignment
```

---

### Prompt 19: Live Production URL Documentation
**Timestamp:** `2026-11-01T16:00:30Z` (Local: `2026-11-01 21:30:30 IST`)

```
I was able to deploy using render platform - can we add this https://enrichment-lookup-coordinator.onrender.com URL to Readme as live URL for the application
```

---

### Prompt 20: Core Requirements & Concurrency Verification
**Timestamp:** `2026-11-01T16:04:11Z` (Local: `2026-11-01 21:34:11 IST`)

```
The system must never allow more lookups than the quota, even under about 200 simultaneous requests
• An indicator can have at most one active lookup (leased or queued) at a time. Requests for the same
indicator should not consume additional quota.
• If a client retries a request with the same idempotency key, it must not consume a second unit
• When no quota is available, requests are queued and promoted in the order they arrived are all these covered ?
```

---

### Prompt 21: Domain Knowledge: Permanently Used Lookups
**Timestamp:** `2026-11-01T16:07:57Z` (Local: `2026-11-01 21:37:57 IST`)

```
what are permanantely used lookups
```

---

### Prompt 22: Test Coverage Report for Frontend & Backend
**Timestamp:** `2026-11-01T16:13:39Z` (Local: `2026-11-01 21:43:39 IST`)

```
can you give me test coverage report of both modules i.e frontend and backend
```

