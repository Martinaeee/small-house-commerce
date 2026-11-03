import { describe, expect, it } from 'vitest';
import { buildCreateOrderPayload, MissingMappingError } from './qianyi-order.mapper.js';

const CONFIG = {
  shop: 'LUWAG- PH',
  warehouseId: 71537,
  warehouse: 'PH-DAVAO-01',
  logistics: 'SHIPDOC-STD',
};

/**
 * Shapes mirror `Order` + `OrderItem` + `OrderShippingAddress` in
 * `prisma/schema/order.prisma`: the address has `fullName` / `barangay` /
 * `postalCode` / `streetAddress`, and a line carries `unitPrice`,
 * `unitDiscount` and `lineTotal` (all Decimal).
 *
 * The money adds up: subtotal 3997 − discount 400 = grandTotal 3597.
 */
const BASE_ORDER = {
  orderNumber: 'PH100012',
  currency: 'PHP',
  shippingTotal: '0.00',
  grandTotal: '3597.00',
  customerNote: 'Please call before delivery',
  createdAt: new Date('2026-10-28T02:30:00.000Z'),
  customer: { email: 'buyer@example.com', name: 'Maria Cruz' },
  shippingAddress: {
    fullName: 'Maria Cruz',
    phone: '639171234567',
    province: 'Metro Manila',
    city: 'Quezon City',
    barangay: 'Culiat',
    postalCode: '1128',
    streetAddress: '12 Sampaguita St',
    landmark: null,
  },
  items: [
    {
      skuCodeSnapshot: 'TB001-Wa',
      quantity: 1,
      unitPrice: '2999.00',
      unitDiscount: '400.00',
      lineTotal: '2599.00',
      sku: { skuCode: 'TB001-Wa', qianyiSkuCode: 'YD003760CMHT' },
    },
    {
      skuCodeSnapshot: 'SH-STOOL-001',
      quantity: 2,
      unitPrice: '499.00',
      unitDiscount: '0.00',
      lineTotal: '998.00',
      sku: { skuCode: 'SH-STOOL-001', qianyiSkuCode: 'A0229BU' },
    },
  ],
};

describe('buildCreateOrderPayload', () => {
  it('maps a COD order onto the documented fields', () => {
    const payload = buildCreateOrderPayload(BASE_ORDER as never, CONFIG) as Record<string, any>;
    expect(payload.shop).toBe('LUWAG- PH');
    expect(payload.onlineOrderNumber).toBe('PH100012');
    expect(payload.paymentMethod).toBe('COD');
    expect(payload.currency).toBe('PHP');
    expect(payload.warehouse).toBe('PH-DAVAO-01');
    expect(payload.warehouseId).toBe(71537);
    expect(payload.logistics).toBe('SHIPDOC-STD');
    expect(payload.payTime).toBe('2026-10-28 10:30:00+08:00');
    expect(payload.codPayAmount).toBe('3597.0000');
  });

  it('reads the real address columns', () => {
    const payload = buildCreateOrderPayload(BASE_ORDER as never, CONFIG) as Record<string, any>;
    expect(payload.buyer).toEqual(
      expect.objectContaining({
        receiverName: 'Maria Cruz',
        phone: '639171234567',
        province: 'Metro Manila',
        city: 'Quezon City',
        district: 'Culiat',
        postCode: '1128',
        address1: '12 Sampaguita St',
        country: 'PH',
      }),
    );
  });

  it('splits the total so the line amounts add up exactly', () => {
    const payload = buildCreateOrderPayload(BASE_ORDER as never, CONFIG) as Record<string, any>;
    const lines = payload.skuList as Array<Record<string, string | number>>;
    const sum = lines.reduce((acc, line) => acc + Math.round(Number(line.payAmount) * 100), 0);
    expect(sum).toBe(359700);
  });

  it('subtracts the line discount from what the buyer pays', () => {
    const payload = buildCreateOrderPayload(BASE_ORDER as never, CONFIG) as Record<string, any>;
    const lines = payload.skuList as Array<Record<string, string>>;
    expect(lines[0].paymentPrice).toBe('2599.0000');
    expect(lines[0].originalPrice).toBe('2999.0000');
    expect(lines[0].promotionDiscount).toBe('400.0000');
  });

  it('puts an uneven freight remainder on the last line, never floating', () => {
    const order = {
      ...BASE_ORDER,
      shippingTotal: '100.00',
      grandTotal: '400.00',
      items: [
        { ...BASE_ORDER.items[0], unitPrice: '100.00', unitDiscount: '0.00', lineTotal: '100.00' },
        {
          ...BASE_ORDER.items[1],
          quantity: 2,
          unitPrice: '100.00',
          unitDiscount: '0.00',
          lineTotal: '200.00',
        },
      ],
    };
    const payload = buildCreateOrderPayload(order as never, CONFIG) as Record<string, any>;
    const lines = payload.skuList as Array<Record<string, string>>;
    expect(lines.map((l) => l.shippingPrice)).toEqual(['33.3333', '66.6667']);
  });

  it('spreads an order-level promo discount across the lines', () => {
    // The real checkout writes unitDiscount = 0 and keeps the promo code's
    // money on the order, so the allocation has to happen here.
    const order = {
      ...BASE_ORDER,
      discountTotal: '400.00',
      grandTotal: '3597.00',
      items: [
        { ...BASE_ORDER.items[0], unitDiscount: '0.00', lineTotal: '2999.00' },
        { ...BASE_ORDER.items[1], unitDiscount: '0.00', lineTotal: '998.00' },
      ],
    };
    const payload = buildCreateOrderPayload(order as never, CONFIG) as Record<string, any>;
    const lines = payload.skuList as Array<Record<string, string>>;

    // Qianyi takes 4 decimals, so the invariant is the 0.0001 sum, not a
    // per-line rounding to cents (half-cent lines would drift by a cent).
    const paid = lines.reduce(
      (acc, line) => acc + Math.round(Number(line.payAmount) * 10_000),
      0,
    );
    const discounted = lines.reduce(
      (acc, line) => acc + Number(line.promotionDiscount),
      0,
    );
    expect(paid).toBe(35_970_000);
    expect(discounted).toBeCloseTo(400, 3);
  });

  it('refuses to build when a line has no Qianyi code', () => {
    const order = {
      ...BASE_ORDER,
      items: [{ ...BASE_ORDER.items[0], sku: { skuCode: 'TB001-Wa', qianyiSkuCode: null } }],
    };
    expect(() => buildCreateOrderPayload(order as never, CONFIG)).toThrow(MissingMappingError);
  });

  it('never falls back to the store skuCode', () => {
    const order = {
      ...BASE_ORDER,
      items: [{ ...BASE_ORDER.items[0], sku: { skuCode: 'TB001-Wa', qianyiSkuCode: '  ' } }],
    };
    expect(() => buildCreateOrderPayload(order as never, CONFIG)).toThrow(MissingMappingError);
  });
});
