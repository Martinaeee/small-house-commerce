import { describe, expect, it } from 'vitest';
import { updateSettingsSchema } from './settings.dto.js';

const base = {
  messengerUrl: '',
  supportEmail: 'support@luwag.ph',
  supportHours: 'Mon–Sat, 9am–6pm (PHT)',
};

describe('updateSettingsSchema storefront-shell ownership', () => {
  it('strips support email and hours from legacy settings payloads', () => {
    const result = updateSettingsSchema.parse({
      ...base,
      supportPhone: '+63 917 123 4567',
    });

    expect(result).not.toHaveProperty('supportEmail');
    expect(result).not.toHaveProperty('supportHours');
    expect(result.supportPhone).toBe('+63 917 123 4567');
  });
});

describe('updateSettingsSchema supportPhone', () => {
  it.each([
    '',
    '+63 917 123 4567',
    '(02) 8123-4567',
    '0917-123-4567',
  ])('accepts and trims a supported phone value: %s', (supportPhone) => {
    const result = updateSettingsSchema.parse({
      ...base,
      supportPhone: `  ${supportPhone}  `,
    });

    expect(result.supportPhone).toBe(supportPhone);
  });

  it.each([
    'call-me',
    '<script>',
    '123456',
    '+63 917 123 4567 8901',
  ])('rejects an unsupported phone value: %s', (supportPhone) => {
    expect(
      updateSettingsSchema.safeParse({ ...base, supportPhone }).success,
    ).toBe(false);
  });
});
