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
    });

    expect(result).toMatchObject({
      newsletterBandEnabled: false,
      newsletterPopupEnabled: true,
      newsletterPopupDelaySeconds: 8,
      newsletterOfferTitle: 'Subscribe and save',
      newsletterOfferBody: 'Enjoy a welcome discount.',
    });
  });

  it('keeps the new fields optional for existing settings clients', () => {
    expect(updateSettingsSchema.parse(base)).toEqual(base);
  });

  it('rejects an out-of-range popup delay', () => {
    expect(
      updateSettingsSchema.safeParse({
        ...base,
        newsletterPopupDelaySeconds: 121,
      }).success,
    ).toBe(false);
  });
});
