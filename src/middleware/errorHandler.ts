import { Request, Response, NextFunction } from 'express';
import { AppError } from '../services/lookupCoordinator.js';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If response headers already sent, delegate to default express handler
  if (res.headersSent) {
    return next(err);
  }

  // Known application domain errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.code || 'APP_ERROR',
        data: err.data,
      },
    });
    return;
  }

  // PostgreSQL specific error handling
  if (err.code === '23505') {
    logger.warn('Database unique constraint violation', { detail: err.detail, constraint: err.constraint });
    res.status(409).json({
      error: {
        message: 'Conflict: Unique constraint violated in database.',
        code: 'UNIQUE_VIOLATION',
        constraint: err.constraint,
      },
    });
    return;
  }

  if (err.code === '23514') {
    logger.warn('Database check constraint violation', { detail: err.detail, constraint: err.constraint });
    res.status(429).json({
      error: {
        message: 'Quota exceeded or invalid database bounds.',
        code: 'CHECK_CONSTRAINT_VIOLATION',
        constraint: err.constraint,
      },
    });
    return;
  }

  if (err.code === '40001' || err.code === '40P01') {
    logger.warn('Serialization failure or deadlock detected', { code: err.code });
    res.status(503).json({
      error: {
        message: 'Database concurrency conflict detected. Please retry request.',
        code: 'CONCURRENCY_RETRY',
      },
    });
    return;
  }

  // Fallthrough unhandled error
  logger.error('Unhandled internal server error', err);
  res.status(500).json({
    error: {
      message: 'Internal server error occurred.',
      code: 'INTERNAL_SERVER_ERROR',
    },
  });
}

