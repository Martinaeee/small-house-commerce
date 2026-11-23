import { describe, expect, it } from 'vitest';
import { readSunrateConfig } from './sunrate.config.js';

/** Minimal ConfigService stand-in: only `.get` is used. */
const configOf = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

describe('readSunrateConfig', () => {
  it('is off when nothing is configured', () => {
    const cfg = readSunrateConfig(configOf({}) as never);
    expect(cfg).toBeNull();
  });

  it('is off when only some credentials are present', () => {
    const cfg = readSunrateConfig(
      configOf({ 'sunrate.enabled': 'true', 'sunrate.env': 'test', 'sunrate.merchantId': 'TEST1' }) as never,
    );
    expect(cfg).toBeNull();
  });

  it('binds the test env to the official test host', () => {
    const cfg = readSunrateConfig(
      configOf({
        'sunrate.enabled': 'true',
        'sunrate.env': 'test',
        'sunrate.merchantId': 'TEST34453112600',
        'sunrate.signKey': 'yvct1tg0egp48i0ubyrvnbjh6jqi1zo7',
        'payments.publicBaseUrl': 'https://luwag.shop',
      }) as never,
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.env).toBe('test');
    expect(cfg!.baseUrl).toBe('https://test-api.xunhuiacq.com');
    expect(cfg!.enabled).toBe(true);
    expect(cfg!.publicBaseUrl).toBe('https://luwag.shop');
  });

  it('binds production to the official production host only with explicit production', () => {
    const cfg = readSunrateConfig(
      configOf({
        'sunrate.enabled': 'true',
        'sunrate.env': 'production',
        'sunrate.merchantId': 'M',
        'sunrate.signKey': 'k'.repeat(24),
      }) as never,
    );
    expect(cfg!.baseUrl).toBe('https://api.acq.sunrate.com');
  });

  it('stays off when a base URL contradicts the environment', () => {
    const cfg = readSunrateConfig(
      configOf({
        'sunrate.enabled': 'true',
        'sunrate.env': 'test',
        'sunrate.baseUrl': 'https://api.acq.sunrate.com',
        'sunrate.merchantId': 'M',
        'sunrate.signKey': 'k'.repeat(24),
      }) as never,
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.enabled).toBe(false);
  });

  it('is off without a payments public base URL in production env value', () => {
    const cfg = readSunrateConfig(
      configOf({
        'sunrate.enabled': 'true',
        'sunrate.env': 'production',
        'sunrate.merchantId': 'M',
        'sunrate.signKey': 'k'.repeat(24),
      }) as never,
    );
    // publicBaseUrl missing: frontURL/backURL could not be built safely.
    expect(cfg!.enabled).toBe(false);
    expect(cfg!.publicBaseUrl).toBe('');
  });
});
