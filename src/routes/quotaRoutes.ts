import { Router, Request, Response, NextFunction } from 'express';
import { quotaService } from '../services/quotaService.js';

export const quotaRouter = Router();

quotaRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const quota = await quotaService.getTodayQuota();
    res.json(quota);
  } catch (err) {
    next(err);
  }
});

