import { Injectable, Logger } from '@nestjs/common';
import type {
  BackInStockEmailOptions,
  EmailGateway,
  WelcomeEmailOptions,
} from './email.gateway.js';

interface LogSink {
  log(message: string): void;
}

/**
 * Default gateway when EMAIL_API_KEY is unset: logs the intended message so
 * local development and e2e exercise the flow without an external provider.
 */
@Injectable()
export class LogEmailGateway implements EmailGateway {
  constructor(private readonly logger: LogSink = new Logger('EmailGateway')) {}

  async sendWelcome(
    to: string,
    options: WelcomeEmailOptions,
  ): Promise<void> {
    this.logger.log(JSON.stringify({ kind: 'welcome', to, ...options }));
  }

  async sendBackInStock(
    to: string,
    options: BackInStockEmailOptions,
  ): Promise<void> {
    this.logger.log(JSON.stringify({ kind: 'back-in-stock', to, ...options }));
  }
}
