import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { readQianyiConfig } from './qianyi.config.js';

function configOf(values: Record<string, unknown>): ConfigService {
  return new ConfigService(values);
}

const COMPLETE = {
  qianyi: {
    enabled: 'true',
    appId: 'test-app-id-0001',
    appSecret: 'x'.repeat(32),
    shop: 'LUWAG- PH',
    warehouseId: 71537,
    warehouse: 'PH-DAVAO-01',
    logistics: 'SHIPDOC-STD',
  },
};

describe('readQianyiConfig', () => {
  it('stays disabled when nothing is configured', () => {
    expect(readQianyiConfig(configOf({})).enabled).toBe(false);
  });

  it('is enabled once every required value and the flag are present', () => {
    const config = readQianyiConfig(configOf(COMPLETE));
    expect(config.enabled).toBe(true);
    expect(config.shop).toBe('LUWAG- PH');
    expect(config.warehouseId).toBe(71537);
    expect(config.baseUrl).toBe('https://www.qianyierp.com');
  });

  it('refuses to enable when the flag is on but a value is missing', () => {
    const config = readQianyiConfig(
      configOf({ qianyi: { ...COMPLETE.qianyi, warehouseId: 0 } }),
    );
    expect(config.enabled).toBe(false);
  });

  it('accepts 1 as the enabled flag', () => {
    const config = readQianyiConfig(
      configOf({ qianyi: { ...COMPLETE.qianyi, enabled: '1' } }),
    );
    expect(config.enabled).toBe(true);
  });
});
