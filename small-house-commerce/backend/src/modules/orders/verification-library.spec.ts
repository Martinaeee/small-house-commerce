import { describe, expect, it } from 'vitest';
import {
  VERIFICATION_LIBRARY,
  VERIFICATION_TEMPLATES,
  verificationItemByKey,
  verificationItemsForKeys,
} from './verification-library.js';

describe('verification library', () => {
  it('covers every category the workbench groups by', () => {
    const categories = new Set(VERIFICATION_LIBRARY.map((item) => item.category));
    expect([...categories].sort()).toEqual([
      'COD_PAYMENT',
      'CUSTOMER_INFO',
      'DELIVERY_SCHEDULE',
      'PRODUCT_INFO',
      'RISK_REVIEW',
      'SHIPPING_ADDRESS',
    ]);
  });

  it('gives every item a stable unique key, a title and a subject', () => {
    const keys = VERIFICATION_LIBRARY.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of VERIFICATION_LIBRARY) {
      expect(item.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.subject).toBeTruthy();
    }
  });

  it('marks no question as mandatory', () => {
    // The operator ticks what applies to the order in front of them; the
    // checklist never blocks the confirmation.
    expect(
      VERIFICATION_LIBRARY.filter((i) => (i as { required?: boolean }).required),
    ).toEqual([]);
  });

  it('binds each item to the subject its result depends on', () => {
    expect(verificationItemByKey('addr_area')?.subject).toBe('SHIPPING_ADDRESS');
    expect(verificationItemByKey('addr_mark')?.subject).toBe('SHIPPING_ADDRESS');
    expect(verificationItemByKey('variant')?.subject).toBe('ORDER_ITEMS');
    expect(verificationItemByKey('qty')?.subject).toBe('ORDER_ITEMS');
    expect(verificationItemByKey('cod_amount')?.subject).toBe('AMOUNT');
    expect(verificationItemByKey('cod_fee')?.subject).toBe('AMOUNT');
    expect(verificationItemByKey('phone_valid')?.subject).toBe('CUSTOMER_IDENTITY');
    expect(verificationItemByKey('intent')?.subject).toBe('CUSTOMER_IDENTITY');
    expect(verificationItemByKey('dup')?.subject).toBe('DUPLICATE_WINDOW');
    expect(verificationItemByKey('deliver_at')?.subject).toBe('DELIVERY_PREFERENCE');
    expect(verificationItemByKey('flag_review')?.subject).toBe('RISK_FLAGS');
  });

  it('only references known items in the shipped templates', () => {
    const known = new Set(VERIFICATION_LIBRARY.map((i) => i.key));
    for (const template of VERIFICATION_TEMPLATES) {
      expect(template.items.length).toBeGreaterThan(0);
      for (const key of template.items) expect(known.has(key)).toBe(true);
    }
  });

  it('resolves a set of keys and ignores unknown ones', () => {
    const items = verificationItemsForKeys(['intent', 'not_a_real_key', 'addr_area']);
    expect(items.map((i) => i.key)).toEqual(['intent', 'addr_area']);
  });

  it('returns undefined for an unknown key', () => {
    expect(verificationItemByKey('not_a_real_key')).toBeUndefined();
  });
});
