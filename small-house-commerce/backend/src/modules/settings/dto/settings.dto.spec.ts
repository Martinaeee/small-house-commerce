import { describe, expect, it } from 'vitest';
import { updateSettingsSchema } from './settings.dto.js';

const base = {
  messengerUrl: '',
  supportEmail: 'support@luwag.ph',
  supportHours: 'Mon–Sat, 9am–6pm (PHT)',
};

describe('updateSettingsSchema newsletter fields', () => {
  it('accepts and normalizes the complete newsletter display configuration', () => {
    const result = updateSettingsSchema.parse({
      ...base,
      newsletterBandEnabled: false,
      newsletterPopupEnabled: true,
      newsletterPopupDelaySeconds: '8',
      newsletterOfferTitle: '  Subscribe and save  ',
      newsletterOfferBody: '  Enjoy a welcome discount.  ',
      newsletterEyebrow: '  The LUWAG edit  ',
      newsletterFormTitle: '  Subscribe by email  ',
      newsletterEmailPlaceholder: '  Your email address  ',
      newsletterConsentText:
        '  By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.  ',
    });

    expect(result).toMatchObject({
      newsletterBandEnabled: false,
      newsletterPopupEnabled: true,
      newsletterPopupDelaySeconds: 8,
      newsletterOfferTitle: 'Subscribe and save',
      newsletterOfferBody: 'Enjoy a welcome discount.',
      newsletterEyebrow: 'The LUWAG edit',
      newsletterFormTitle: 'Subscribe by email',
      newsletterEmailPlaceholder: 'Your email address',
      newsletterConsentText:
        'By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.',
    });
  });

  it('keeps newsletter fields optional and strips shell-owned footer fields', () => {
    const result = updateSettingsSchema.parse(base);

    expect(result).toEqual({ messengerUrl: '' });
    expect(result).not.toHaveProperty('supportEmail');
    expect(result).not.toHaveProperty('supportHours');
  });

  it('rejects an out-of-range popup delay', () => {
    expect(
      updateSettingsSchema.safeParse({
        ...base,
        newsletterPopupDelaySeconds: 121,
      }).success,
    ).toBe(false);
  });

  it.each([
    ['newsletterEyebrow', ''],
    ['newsletterFormTitle', '   '],
    ['newsletterEmailPlaceholder', ''],
    ['newsletterConsentText', '   '],
  ] as const)('rejects blank %s copy', (field, value) => {
    expect(
      updateSettingsSchema.safeParse({ ...base, [field]: value }).success,
    ).toBe(false);
  });

  it.each([
    ['newsletterEyebrow', 'x'.repeat(81)],
    ['newsletterFormTitle', 'x'.repeat(121)],
    ['newsletterEmailPlaceholder', 'x'.repeat(121)],
    ['newsletterConsentText', 'x'.repeat(501)],
  ] as const)('rejects oversized %s copy', (field, value) => {
    expect(
      updateSettingsSchema.safeParse({ ...base, [field]: value }).success,
    ).toBe(false);
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
