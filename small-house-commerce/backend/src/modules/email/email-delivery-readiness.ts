import type { ConfigService } from '@nestjs/config';

/**
 * Log delivery is intentional outside production. Production stock alerts are
 * enabled only when the real provider and every public email URL dependency
 * are configured.
 */
export function isEmailDeliveryEnabled(config: ConfigService): boolean {
  if (config.get<boolean>('app.isProduction') !== true) return true;

  return [
    config.get<string>('email.apiKey'),
    config.get<string>('email.from'),
    config.get<string>('email.storefrontBaseUrl'),
  ].every((value) => typeof value === 'string' && value.trim().length > 0);
}
