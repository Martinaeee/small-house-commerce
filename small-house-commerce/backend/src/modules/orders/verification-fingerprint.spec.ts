import { describe, expect, it } from 'vitest';
import {
  subjectFingerprint,
  type VerificationFingerprintInput,
} from './verification-fingerprint.js';

const base: VerificationFingerprintInput = {
  customer: { normalizedPhone: '+639171224466', name: 'Marisol Reyes' },
  address: {
    streetAddress: '24-B Kamuning St.',
    barangay: 'Kamuning',
    city: 'Quezon City',
    province: 'Metro Manila',
    postalCode: '1103',
    landmark: null,
  },
  items: [{ skuCode: 'SKU-FD-140-WN', quantity: 1 }],
  amount: { subtotal: '1499.00', discountTotal: '0.00', shippingTotal: '0.00', grandTotal: '1499.00' },
  delivery: { preferredDeliveryDate: null, customerNote: null },
  riskFlags: [],
  orderCreatedAt: '2026-10-21T14:22:00.000Z',
};

const clone = (): VerificationFingerprintInput => JSON.parse(JSON.stringify(base)) as VerificationFingerprintInput;

describe('verification fingerprints', () => {
  it('is stable for the same facts', () => {
    expect(subjectFingerprint('SHIPPING_ADDRESS', base)).toBe(subjectFingerprint('SHIPPING_ADDRESS', clone()));
  });

  it('ignores the order of the item lines', () => {
    const a = clone();
    const b = clone();
    b.items = [
      { skuCode: 'SKU-B', quantity: 2 },
      { skuCode: 'SKU-A', quantity: 1 },
    ];
    a.items = [
      { skuCode: 'SKU-A', quantity: 1 },
      { skuCode: 'SKU-B', quantity: 2 },
    ];
    expect(subjectFingerprint('ORDER_ITEMS', a)).toBe(subjectFingerprint('ORDER_ITEMS', b));
  });

  it('changes the address fingerprint when the address changes', () => {
    const next = clone();
    next.address = { ...next.address!, barangay: 'Bagong Silang' };
    expect(subjectFingerprint('SHIPPING_ADDRESS', next)).not.toBe(subjectFingerprint('SHIPPING_ADDRESS', base));
    expect(subjectFingerprint('ORDER_ITEMS', next)).toBe(subjectFingerprint('ORDER_ITEMS', base));
    expect(subjectFingerprint('CUSTOMER_IDENTITY', next)).toBe(subjectFingerprint('CUSTOMER_IDENTITY', base));
  });

  it('changes the items fingerprint when the quantity or the SKU changes', () => {
    const fewer = clone();
    fewer.items = [{ skuCode: 'SKU-FD-140-WN', quantity: 2 }];
    expect(subjectFingerprint('ORDER_ITEMS', fewer)).not.toBe(subjectFingerprint('ORDER_ITEMS', base));
    const other = clone();
    other.items = [{ skuCode: 'SKU-FD-140-BK', quantity: 1 }];
    expect(subjectFingerprint('ORDER_ITEMS', other)).not.toBe(subjectFingerprint('ORDER_ITEMS', base));
  });

  it('changes the amount fingerprint when the money changes', () => {
    const discounted = clone();
    discounted.amount = { ...discounted.amount, discountTotal: '99.00', grandTotal: '1400.00' };
    expect(subjectFingerprint('AMOUNT', discounted)).not.toBe(subjectFingerprint('AMOUNT', base));
    expect(subjectFingerprint('SHIPPING_ADDRESS', discounted)).toBe(subjectFingerprint('SHIPPING_ADDRESS', base));
  });

  it('changes the identity fingerprint when the customer identity changes', () => {
    const other = clone();
    other.customer = { normalizedPhone: '+639171224499', name: 'Marisol Reyes' };
    expect(subjectFingerprint('CUSTOMER_IDENTITY', other)).not.toBe(subjectFingerprint('CUSTOMER_IDENTITY', base));
  });

  it('changes the risk fingerprint when the unresolved flags change', () => {
    const flagged = clone();
    flagged.riskFlags = [{ flagType: 'POSSIBLE_DUPLICATE' }];
    expect(subjectFingerprint('RISK_FLAGS', flagged)).not.toBe(subjectFingerprint('RISK_FLAGS', base));
  });

  it('changes the duplicate fingerprint when the phone, the SKUs or the order time change', () => {
    const otherPhone = clone();
    otherPhone.customer = { ...otherPhone.customer, normalizedPhone: '+639171224499' };
    expect(subjectFingerprint('DUPLICATE_WINDOW', otherPhone)).not.toBe(subjectFingerprint('DUPLICATE_WINDOW', base));

    const otherItems = clone();
    otherItems.items = [{ skuCode: 'SKU-OTHER', quantity: 1 }];
    expect(subjectFingerprint('DUPLICATE_WINDOW', otherItems)).not.toBe(subjectFingerprint('DUPLICATE_WINDOW', base));

    const laterOrder = clone();
    laterOrder.orderCreatedAt = '2026-10-22T09:00:00.000Z';
    expect(subjectFingerprint('DUPLICATE_WINDOW', laterOrder)).not.toBe(subjectFingerprint('DUPLICATE_WINDOW', base));
  });

  it('changes the delivery fingerprint when the delivery preference changes', () => {
    const next = clone();
    next.delivery = { preferredDeliveryDate: '2026-10-30', customerNote: '工作日送达' };
    expect(subjectFingerprint('DELIVERY_PREFERENCE', next)).not.toBe(subjectFingerprint('DELIVERY_PREFERENCE', base));
  });
});
