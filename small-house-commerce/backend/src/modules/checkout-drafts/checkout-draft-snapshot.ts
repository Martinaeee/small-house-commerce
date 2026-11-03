import type { CheckoutDraftSaveInput } from './dto/checkout-draft.dto.js';

export interface CheckoutDraftCustomerSnapshot {
  name: string;
  phone: string;
  province: string;
  city: string;
  barangay: string;
  postalCode: string;
  streetAddress: string;
  landmark: string;
}

export interface CheckoutDraftSnapshot {
  customer: CheckoutDraftCustomerSnapshot;
  items: { skuId: string; quantity: number }[];
  preferredDeliveryDate: string | null;
  promoCodeInput: string;
  promoCodeApplied: string | null;
  customerNote: string;
}

export interface CheckoutDraftProductLine {
  skuId: string;
  skuCode: string | null;
  productId: string | null;
  productName: string | null;
  productSlug: string | null;
  variantName: string | null;
  thumbnailUrl: string | null;
  unitPrice: string | null;
  quantity: number;
}

export function buildCheckoutDraftSnapshot(input: CheckoutDraftSaveInput): CheckoutDraftSnapshot {
  return {
    customer: {
      name: input.customer.name.slice(0, 120),
      phone: input.customer.phone.slice(0, 24),
      province: input.customer.province.slice(0, 120),
      city: input.customer.city.slice(0, 120),
      barangay: input.customer.barangay.slice(0, 120),
      postalCode: input.customer.postalCode.slice(0, 20),
      streetAddress: input.customer.streetAddress.slice(0, 255),
      landmark: input.customer.landmark.slice(0, 255),
    },
    items: input.items.slice(0, 100).map((item) => ({ skuId: item.skuId, quantity: item.quantity })),
    preferredDeliveryDate: input.preferredDeliveryDate,
    promoCodeInput: input.promoCodeInput.slice(0, 32),
    promoCodeApplied: input.promoCodeApplied
      ? input.promoCodeApplied.slice(0, 32).toUpperCase()
      : null,
    customerNote: input.customerNote.slice(0, 200),
  };
}

export function contactOf(snapshot: CheckoutDraftSnapshot): {
  name: string | null;
  phone: string | null;
} {
  const name = snapshot.customer.name.trim();
  const phone = snapshot.customer.phone.trim();
  return {
    name: name === '' ? null : name,
    phone: phone === '' ? null : phone,
  };
}
