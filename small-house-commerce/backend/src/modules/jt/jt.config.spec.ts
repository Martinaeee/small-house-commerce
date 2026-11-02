import { describe, expect, it } from 'vitest';
import { readJtConfig } from './jt.config.js';

const base = {
  'jt.enabled': 'true',
  'jt.baseUrl': 'https://jtapi.jtexpress.ph',
  'jt.eccompanyid': 'LUWAG-EC',
  'jt.key': 'test-key',
  'jt.pollMinutes': 30,
  'jt.carrierName': 'J&T Express',
};

const configOf = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as never;

describe('readJtConfig', () => {
  it('is enabled when the flag is on and both credentials are present', () => {
    expect(readJtConfig(configOf(base)).enabled).toBe(true);
  });

  it('stays disabled when the flag is on but the key is missing', () => {
    const values = { ...base, 'jt.key': '' };
    expect(readJtConfig(configOf(values)).enabled).toBe(false);
  });

  it('stays disabled when the flag is off even with full credentials', () => {
    const values = { ...base, 'jt.enabled': 'false' };
    expect(readJtConfig(configOf(values)).enabled).toBe(false);
  });

  it('defaults the poll cadence and carrier label', () => {
    const values = { ...base };
    delete (values as Record<string, unknown>)['jt.pollMinutes'];
    delete (values as Record<string, unknown>)['jt.carrierName'];
    const config = readJtConfig(configOf(values));
    expect(config.pollMinutes).toBe(30);
    expect(config.carrierName).toBe('J&T Express');
  });

  it('falls back to the production host', () => {
    const values = { ...base };
    delete (values as Record<string, unknown>)['jt.baseUrl'];
    expect(readJtConfig(configOf(values)).baseUrl).toBe('https://jtapi.jtexpress.ph');
  });
});
