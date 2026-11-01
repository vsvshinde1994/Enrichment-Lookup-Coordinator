import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { lookupCoordinator } from '../services/lookupCoordinator.js';
import { leaseReaper } from '../worker/leaseReaper.js';

export const lookupRouter = Router();

/**
 * Helper to extract analyst ID from header or body
 */
function getAnalystId(req: Request): string {
  const headerId = req.headers['x-analyst-id'];
  if (typeof headerId === 'string' && headerId.trim()) {
    return headerId.trim();
  }
  if (req.body && typeof req.body.analystId === 'string' && req.body.analystId.trim()) {
    return req.body.analystId.trim();
  }
  return '';
}

/**
 * Helper to extract idempotency key from header or body (with fallback to unique UUID)
 */
function getIdempotencyKey(req: Request): string {
  const headerKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }
  if (req.body && typeof req.body.idempotencyKey === 'string' && req.body.idempotencyKey.trim()) {
    return req.body.idempotencyKey.trim();
  }
  return crypto.randomUUID();
}

/**
 * POST /api/enrichments - Request an enrichment lookup (Reserves slot or Enqueues)
 */
lookupRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const analystId = getAnalystId(req);
    const idempotencyKey = getIdempotencyKey(req);
    const indicator = req.body?.indicator;

    const { dto, isRetry } = await lookupCoordinator.createRequest({
      analystId,
      idempotencyKey,
      indicator,
    });

    // Return 200 for idempotent retries, 201 for fresh creations
    res.status(isRetry ? 200 : 201).json(dto);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/enrichments/:id/execute - Run a lookup while lease is valid
 */
lookupRouter.post('/:id/execute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const analystId = getAnalystId(req);
    const requestId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const dto = await lookupCoordinator.executeLookup(requestId, analystId);
    res.status(200).json(dto);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/enrichments/:id - Check status, countdown, queue position, or verdict
 */
lookupRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const dto = await lookupCoordinator.getRequestById(requestId);
    res.status(200).json(dto);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/enrichments - List enrichments for UI dashboard
 */
lookupRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const analystId = typeof req.query.analystId === 'string' ? req.query.analystId : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const list = await lookupCoordinator.listRequests(analystId, limit);
    res.status(200).json(list);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/maintenance/reconcile - Trigger immediate expiry and promotion cycle
 */
lookupRouter.post('/maintenance/reconcile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await leaseReaper.runCycle();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
