import { ConfigService } from '@nestjs/config';

/**
 * Everything the Qianyi integration needs, read from the validated env tree
 * (`qianyi.*` in configuration.ts). `enabled` is derived, never trusted on its
 * own: a half-configured integration must stay off rather than fire requests
 * with an empty secret.
 */
export interface QianyiConfig {
  enabled: boolean;
  baseUrl: string;
  appId: string;
  secret: string;
  shop: string;
  warehouseId: number;
  warehouse: string;
  /** Local Warehouse row that books Qianyi's shipments; null = first active. */
  localWarehouseId: string | null;
  logistics: string;
  /**
   * Whether Qianyi's prepaid payment enum for online (SUNRATE) orders has
   * been confirmed with Qianyi. Until it has, an online order that is paid
   * is held back instead of being pushed with the wrong payment type.
   */
  prepaidVerified: boolean;
}

export function readQianyiConfig(config: ConfigService): QianyiConfig {
  const appId = config.get<string>('qianyi.appId') ?? '';
  const secret = config.get<string>('qianyi.appSecret') ?? '';
  const shop = config.get<string>('qianyi.shop') ?? '';
  const warehouseId = config.get<number>('qianyi.warehouseId') ?? 0;
  const warehouse = config.get<string>('qianyi.warehouse') ?? '';
  const logistics = config.get<string>('qianyi.logistics') ?? '';
  const localWarehouseId = config.get<string>('qianyi.localWarehouseId') ?? null;
  const flag = String(config.get<string>('qianyi.enabled') ?? 'false').trim().toLowerCase();
  const prepaidFlag = String(config.get<string>('qianyi.prepaidVerified') ?? 'false')
    .trim()
    .toLowerCase();
  const complete = Boolean(
    appId && secret && shop && warehouseId > 0 && warehouse && logistics,
  );
  return {
    enabled: (flag === 'true' || flag === '1') && complete,
    baseUrl: config.get<string>('qianyi.baseUrl') ?? 'https://www.qianyierp.com',
    appId,
    secret,
    shop,
    warehouseId,
    warehouse,
    localWarehouseId,
    logistics,
    prepaidVerified: prepaidFlag === 'true' || prepaidFlag === '1',
  };
}
