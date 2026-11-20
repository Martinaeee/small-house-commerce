import { ConfigService } from '@nestjs/config';

/**
 * Everything the SUNRATE acquiring integration needs, read from the validated
 * env tree (`sunrate.*` / `payments.*` in configuration.ts). Mirrors the
 * Qianyi pattern: `enabled` is derived, never trusted on its own — a
 * half-configured integration stays off rather than firing requests.
 *
 * The gateway host is BOUND to the environment and never accepted from
 * arbitrary configuration: test ↔ test-api.xunhuiacq.com, production ↔
 * api.acq.sunrate.com. A contradicting SUNRATE_BASE_URL switches the module
 * off instead of sending production merchants to a test host (or worse).
 */
export const SUNRATE_TEST_API = 'https://test-api.xunhuiacq.com';
export const SUNRATE_PRODUCTION_API = 'https://api.acq.sunrate.com';

export interface SunrateConfig {
  /** env flag AND complete credentials AND consistent base URL AND public base URL. */
  enabled: boolean;
  env: 'test' | 'production';
  baseUrl: string;
  merchantId: string;
  signKey: string;
  /** Site origin used to build frontURL / backURL; never taken from request headers. */
  publicBaseUrl: string;
}

const officialHostFor = (env: 'test' | 'production'): string =>
  env === 'test' ? SUNRATE_TEST_API : SUNRATE_PRODUCTION_API;

export function readSunrateConfig(config: ConfigService): SunrateConfig | null {
  const env = config.get<string>('sunrate.env');
  const merchantId = config.get<string>('sunrate.merchantId') ?? '';
  const signKey = config.get<string>('sunrate.signKey') ?? '';
  if (env !== 'test' && env !== 'production') return null;
  if (!merchantId || !signKey) return null;

  const baseUrl = officialHostFor(env);
  const configuredBase = config.get<string>('sunrate.baseUrl');
  const contradicting = Boolean(configuredBase) && configuredBase !== baseUrl;
  const publicBaseUrl = (config.get<string>('payments.publicBaseUrl') ?? '').replace(/\/+$/, '');
  const flag = String(config.get<string>('sunrate.enabled') ?? 'false').trim().toLowerCase();

  return {
    // frontURL/backURL cannot be built without the public origin, so a
    // missing one keeps the module off even with valid credentials.
    enabled:
      (flag === 'true' || flag === '1') && !contradicting && publicBaseUrl.length > 0,
    env,
    baseUrl,
    merchantId,
    signKey,
    publicBaseUrl,
  };
}
