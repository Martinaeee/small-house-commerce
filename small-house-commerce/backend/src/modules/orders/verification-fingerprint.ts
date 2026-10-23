import { createHash } from 'node:crypto';
import type { VerificationSubject } from './verification-library.js';

/**
 * A verification result is only valid for the facts it was verified against.
 * Every result therefore stores a fingerprint of the subject it depends on
 * (the address, the items, the amount, ...). When the order changes
 * materially the fingerprint no longer matches and the result is invalidated
 * and has to be verified again - it is never silently kept.
 */
export interface VerificationFingerprintInput {
  customer: { normalizedPhone: string; name: string };
  address: {
    streetAddress: string | null;
    barangay: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    landmark: string | null;
  } | null;
  items: { skuCode: string; quantity: number }[];
  amount: { subtotal: string; discountTotal: string; shippingTotal: string; grandTotal: string };
  delivery: { preferredDeliveryDate: string | null; customerNote: string | null };
  /** The unresolved risk flags only - resolved ones no longer constrain. */
  riskFlags: { flagType: string }[];
  orderCreatedAt: string;
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function subjectPayload(subject: VerificationSubject, input: VerificationFingerprintInput): unknown {
  switch (subject) {
    case 'CUSTOMER_IDENTITY':
      return { phone: input.customer.normalizedPhone, name: input.customer.name };
    case 'ORDER_ITEMS':
      // The line order is irrelevant: only the set of SKU/quantity pairs counts.
      return {
        items: input.items
          .map((item) => ({ sku: item.skuCode, qty: item.quantity }))
          .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)),
      };
    case 'SHIPPING_ADDRESS':
      return input.address;
    case 'AMOUNT':
      return input.amount;
    case 'DELIVERY_PREFERENCE':
      return input.delivery;
    case 'RISK_FLAGS':
      return { flags: input.riskFlags.map((f) => f.flagType).sort() };
    case 'DUPLICATE_WINDOW':
      return {
        phone: input.customer.normalizedPhone,
        skus: input.items.map((i) => i.skuCode).sort(),
        createdAt: input.orderCreatedAt,
      };
  }
}

export function subjectFingerprint(subject: VerificationSubject, input: VerificationFingerprintInput): string {
  return createHash('sha256').update(canonical(subjectPayload(subject, input))).digest('hex');
}
