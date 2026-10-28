/**
 * Pure mapping from our order shape to `CREATE_AND_AUDIT_SALES_ORDER`.
 *
 * Money never becomes a float: every amount is handled as integer units of
 * 0.0001 (the 4 decimals Qianyi asks for) and only rendered as a string at the
 * boundary, so the line amounts always add up to the order total.
 */

export class MissingMappingError extends Error {
  constructor(readonly skuCodes: string[]) {
    super(
      `No Qianyi code for ${skuCodes.join(', ')}. Map the SKU before pushing the order.`,
    );
    this.name = 'MissingMappingError';
  }
}

export interface QianyiMapperConfig {
  shop: string;
  warehouseId: number;
  warehouse: string;
  logistics: string;
}

type Decimalish = string | { toString(): string };

interface MapperLine {
  skuCodeSnapshot: string;
  quantity: number;
  unitPrice: Decimalish;
  unitDiscount: Decimalish;
  lineTotal: Decimalish;
  sku?: { skuCode: string; qianyiSkuCode: string | null } | null;
}

interface MapperAddress {
  fullName: string;
  phone: string;
  province: string;
  city: string;
  barangay: string | null;
  postalCode: string | null;
  streetAddress: string;
  landmark: string | null;
}

export interface QianyiOrderSource {
  orderNumber: string;
  currency: string;
  shippingTotal: Decimalish;
  grandTotal: Decimalish;
  customerNote: string | null;
  createdAt: Date;
  customer: { email: string | null; name: string | null };
  shippingAddress: MapperAddress | null;
  items: MapperLine[];
}

const UNITS = 10_000n;

const toUnits = (value: Decimalish): bigint => BigInt(Math.round(Number(value.toString()) * 10_000));

const fromUnits = (units: bigint): string => {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / UNITS;
  const frac = abs % UNITS;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(4, '0')}`;
};

/** Splits `total` across `weights`; the remainder lands on the last slice. */
function allocate(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const out: bigint[] = [];
  let allocated = 0n;
  weights.forEach((weight, index) => {
    if (index === weights.length - 1) {
      out.push(total - allocated);
      return;
    }
    const share = (total * weight) / sum;
    out.push(share);
    allocated += share;
  });
  return out;
}

/** `+08:00` is what the documented `payTime` format expects. */
function formatPhTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}+08:00`;
}

export function buildCreateOrderPayload(
  order: QianyiOrderSource,
  config: QianyiMapperConfig,
): Record<string, unknown> {
  const missing = order.items
    .filter((item) => !item.sku?.qianyiSkuCode?.trim())
    .map((item) => item.sku?.skuCode ?? item.skuCodeSnapshot);
  if (missing.length > 0) throw new MissingMappingError(missing);

  const address = order.shippingAddress;
  const netLines = order.items.map(
    (item) =>
      (toUnits(item.unitPrice) - toUnits(item.unitDiscount)) * BigInt(item.quantity),
  );
  const shippingShares = allocate(toUnits(order.shippingTotal), netLines);

  // The order-level freight is the source of truth; line shares only explain
  // how it was distributed, so the last line absorbs the rounding.
  let shippedSoFar = 0n;
  const skuList = order.items.map((item, index) => {
    const unitNet = toUnits(item.unitPrice) - toUnits(item.unitDiscount);
    const shippingShare =
      index === order.items.length - 1
        ? toUnits(order.shippingTotal) - shippedSoFar
        : shippingShares[index];
    shippedSoFar += shippingShare;
    return {
      sku: item.sku!.qianyiSkuCode!.trim(),
      quantity: item.quantity,
      paymentPrice: fromUnits(unitNet),
      shippingPrice: fromUnits(shippingShare),
      payAmount: fromUnits(netLines[index] + shippingShare),
      promotionDiscount: fromUnits(toUnits(item.unitDiscount) * BigInt(item.quantity)),
      originalPrice: fromUnits(toUnits(item.unitPrice)),
    };
  });

  return {
    shop: config.shop,
    onlineOrderNumber: order.orderNumber,
    paymentMethod: 'COD',
    codPayAmount: fromUnits(toUnits(order.grandTotal)),
    freight: fromUnits(toUnits(order.shippingTotal)),
    currency: order.currency,
    buyerMessage: order.customerNote?.slice(0, 1024) ?? undefined,
    // COD has no payment moment, so the order time is the agreed stand-in.
    payTime: formatPhTime(order.createdAt),
    warehouse: config.warehouse,
    warehouseId: config.warehouseId,
    logistics: config.logistics,
    buyer: {
      receiverName: (address?.fullName ?? order.customer.name ?? '').slice(0, 255),
      phone: address?.phone?.slice(0, 50),
      email: order.customer.email?.slice(0, 255),
      // The storefront only serves the Philippines, so the country is fixed
      // rather than read from a column that does not exist.
      country: 'PH',
      province: address?.province ?? '',
      city: address?.city ?? '',
      district: address?.barangay ?? undefined,
      address1: address?.streetAddress?.slice(0, 255) ?? '',
      postCode: address?.postalCode ?? '',
    },
    skuList,
  };
}
