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
  apiAccount: string;
  privateKey: string;
  customerCode: string;
  customerPassword: string;
  pollMinutes: number;
  carrierName: string;
}

export const JT_DEFAULT_BASE_URL =
  'https://openapi.jtexpress.ph/webopenplatformapi/api';

export function readJtConfig(config: ConfigService): JtConfig {
  const enabledFlag = config.get<string>('jt.enabled') ?? 'false';
  const apiAccount = config.get<string>('jt.apiAccount') ?? '';
  const privateKey = config.get<string>('jt.privateKey') ?? '';
  const customerCode = config.get<string>('jt.customerCode') ?? '';
  const customerPassword = config.get<string>('jt.customerPassword') ?? '';
  const complete = Boolean(
    apiAccount && privateKey && customerCode && customerPassword,
  );
  const pollMinutes = config.get<number>('jt.pollMinutes') ?? 30;
  return {
    enabled: enabledFlag === 'true' && complete,
    baseUrl: config.get<string>('jt.baseUrl') || JT_DEFAULT_BASE_URL,
    apiAccount,
    privateKey,
    customerCode,
    customerPassword,
    pollMinutes: pollMinutes > 0 ? pollMinutes : 30,
    carrierName: config.get<string>('jt.carrierName') || 'J&T Express',
  };
}
