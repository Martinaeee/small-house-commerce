import { createHash } from 'node:crypto';
import { normalizePhilippinePhone } from '../../common/phone.util.js';
import type { CheckoutInput } from './dto/order.dto.js';

/**
 * Stable digest of the fields that define an order. Request metadata that can
 * change between retries without changing what was bought (attribution,
 * tracking session, Meta cookies, consent, marketing credential) is excluded,
 * so a plain retry always matches while an edited cart or address does not.
 */
export function idempotencyFingerprint(input: CheckoutInput): string {
  const items = input.items
    .map((item) => ({ skuId: item.skuId, quantity: item.quantity }))
    .sort((left, right) => left.skuId.localeCompare(right.skuId) || left.quantity - right.quantity);
  const content = {
    customer: {
      name: input.customer.name.trim(),
      phone: normalizePhilippinePhone(input.customer.phone) ?? input.customer.phone.trim(),
      province: input.customer.province.trim(),
      city: input.customer.city.trim(),
      barangay: input.customer.barangay?.trim() || null,
      postalCode: input.customer.postalCode?.trim() || null,
      streetAddress: input.customer.streetAddress.trim(),
      landmark: input.customer.landmark?.trim() || null,
    },
    items,
    promoCode: input.promoCode ?? null,
    customerNote: input.customerNote ?? null,
    preferredDeliveryDate: input.preferredDeliveryDate ?? null,
  };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
