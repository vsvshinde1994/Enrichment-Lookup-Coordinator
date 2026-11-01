import { lookupCoordinator } from '../services/lookupCoordinator.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class LeaseReaperWorker {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  /**
   * Starts the background reaper cycle.
   */
  start(): void {
    if (this.timer) return;

    logger.info(`Starting LeaseReaperWorker with interval ${env.REAPER_INTERVAL_MS}ms`);

    this.timer = setInterval(async () => {
      await this.runCycle();
    }, env.REAPER_INTERVAL_MS);

    // Run first cycle immediately
    this.runCycle().catch((err) => {
      logger.error('Error in initial LeaseReaper cycle', err);
    });
  }

  /**
   * Runs a single reconciliation cycle safely.
   */
  async runCycle(): Promise<{ expiredCount: number; promotedCount: number }> {
    if (this.isProcessing) {
      return { expiredCount: 0, promotedCount: 0 };
    }

    this.isProcessing = true;
    try {
      const result = await lookupCoordinator.reconcileExpiredLeasesAndPromote();
      if (result.expiredCount > 0 || result.promotedCount > 0) {
        logger.info('Reconciliation cycle completed', result);
      }
      return result;
    } catch (err) {
      logger.error('Error during LeaseReaper cycle', err);
      return { expiredCount: 0, promotedCount: 0 };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Stops background cycle.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('LeaseReaperWorker stopped.');
    }
  }
}

export const leaseReaper = new LeaseReaperWorker();

