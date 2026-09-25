import { z } from 'zod';

const normalizedQuery = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .refine((value) => {
    const length = [...value].length;
    return length >= 2 && length <= 100;
  }, 'q must contain 2 to 100 characters');

export const adminSearchQuerySchema = z.object({
  q: normalizedQuery,
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export type AdminSearchQuery = z.infer<typeof adminSearchQuerySchema>;

export interface SearchGroup<T> {
  items: T[];
  hasMore: boolean;
}

export interface ProductSearchHit {
  kind: 'PRODUCT';
  productId: string;
  name: string;
  productCode: string | null;
  slug: string;
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  matchedField: 'PRODUCT_CODE' | 'SKU_CODE' | 'NAME' | 'SLUG';
  matchedText: string;
  matchedSku: {
    skuId: string;
    skuCode: string;
    skuStatus: 'ACTIVE' | 'DISABLED';
    variantId: string;
    variantName: string;
    price: string | null;
    availableInventory: number;
  } | null;
}

export interface OrderSearchHit {
  kind: 'ORDER';
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  confirmationStatus: string;
  customerName: string | null;
  normalizedPhone: string;
  createdAt: string;
  matchedField: 'ORDER_NUMBER' | 'PHONE' | 'CUSTOMER_NAME';
  matchedText: string;
}

export interface CustomerSearchHit {
  kind: 'CUSTOMER';
  customerId: string;
  name: string | null;
  normalizedPhone: string;
  email: string | null;
  riskLevel: string;
  matchedField: 'PHONE' | 'EMAIL' | 'NAME';
  matchedText: string;
}

export interface ShipmentSearchHit {
  kind: 'SHIPMENT';
  shipmentId: string;
  trackingNumber: string;
  carrier: string;
  status: string;
  orderId: string;
  orderNumber: string;
  matchedField: 'TRACKING_NUMBER';
  matchedText: string;
}

export interface AdminSearchResponse {
  query: string;
  groups: {
    products?: SearchGroup<ProductSearchHit>;
    orders?: SearchGroup<OrderSearchHit>;
    customers?: SearchGroup<CustomerSearchHit>;
    shipments?: SearchGroup<ShipmentSearchHit>;
  };
}
