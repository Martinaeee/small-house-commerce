import { ConfigService } from '@nestjs/config';

/**
 * Everything the J&T tracking worker needs, read from the validated env tree
 * (`jt.*` in configuration.ts). `enabled` is derived, never trusted on its
 * own: a half-configured integration must stay off rather than call the
 * carrier with an empty secret.
 */
export interface JtConfig {
  enabled: boolean;
  baseUrl: string;
  eccompanyid: string;
  key: string;
  pollMinutes: number;
  carrierName: string;
}

export const JT_DEFAULT_BASE_URL = 'https://jtapi.jtexpress.ph';

export function readJtConfig(config: ConfigService): JtConfig {
  const enabledFlag = config.get<string>('jt.enabled') ?? 'false';
  const eccompanyid = config.get<string>('jt.eccompanyid') ?? '';
  const key = config.get<string>('jt.key') ?? '';
  const complete = Boolean(eccompanyid && key);
  const pollMinutes = config.get<number>('jt.pollMinutes') ?? 30;
  return {
    enabled: enabledFlag === 'true' && complete,
    baseUrl: config.get<string>('jt.baseUrl') || JT_DEFAULT_BASE_URL,
    eccompanyid,
    key,
    pollMinutes: pollMinutes > 0 ? pollMinutes : 30,
    carrierName: config.get<string>('jt.carrierName') || 'J&T Express',
  };
}
