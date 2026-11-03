import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CheckoutDraftsService } from './checkout-drafts.service.js';

const TICK_MS = 60 * 60_000;

@Injectable()
export class CheckoutDraftsCleanup implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckoutDraftsCleanup.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly drafts: CheckoutDraftsService) {}

  onModuleInit(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    void this.drafts
      .prune()
      .then(({ expired, deleted }) => {
        if (expired > 0 || deleted > 0) {
          this.logger.log(`checkout drafts: expired=${expired} deleted=${deleted}`);
        }
      })
      .catch((error: unknown) => {
        this.logger.error(`checkout draft cleanup failed: ${String(error)}`);
      });
  }
}
