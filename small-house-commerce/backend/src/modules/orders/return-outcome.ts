import type { OrderStatus, ShipmentStatus } from '../../generated/prisma/client.js';

export interface ShipmentLine {
  orderItemId: string;
  quantity: number;
}

export interface ShipmentSnapshot {
  id: string;
  status: ShipmentStatus;
  items: ShipmentLine[];
}

export interface OrderLineSnapshot {
  id: string;
  quantity: number;
}

export function quantityByLine(items: ShipmentLine[]) {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.orderItemId, (totals.get(item.orderItemId) ?? 0) + item.quantity);
  }
  return totals;
}

/** Every unit in this box has come back to the warehouse. */
export function isBoxFullyReturned(
  box: ShipmentSnapshot,
  acceptedInBox: Map<string, number>,
) {
  const shipped = quantityByLine(box.items);
  if (shipped.size === 0) return false;
  for (const [orderItemId, quantity] of shipped) {
    if ((acceptedInBox.get(orderItemId) ?? 0) < quantity) return false;
  }
  return true;
}

/**
 * The whole order is accounted for as returned: every line was shipped in
 * full and every shipped unit came back. Unshipped goods keep the order open.
 */
export function isOrderFullyReturned(
  lines: OrderLineSnapshot[],
  shipments: ShipmentSnapshot[],
  acceptedAll: Map<string, number>,
) {
  const shipped = new Map<string, number>();
  for (const box of shipments) {
    for (const [orderItemId, quantity] of quantityByLine(box.items)) {
      shipped.set(orderItemId, (shipped.get(orderItemId) ?? 0) + quantity);
    }
  }
  return lines.every(
    (line) =>
      (shipped.get(line.id) ?? 0) >= line.quantity &&
      (acceptedAll.get(line.id) ?? 0) >= line.quantity,
  );
}

export function hasDeliveredUnits(shipments: ShipmentSnapshot[]) {
  return shipments.some(
    (box) => box.status === 'SIGNED' || box.status === 'PARTIALLY_RETURNED',
  );
}

export function hasOpenShipment(shipments: ShipmentSnapshot[]) {
  return shipments.some((box) => box.status === 'SHIPPING');
}

/** Order status after an RTO acceptance. Returns null when nothing changes. */
export function orderStatusAfterAcceptance(input: {
  lines: OrderLineSnapshot[];
  shipments: ShipmentSnapshot[];
  acceptedAll: Map<string, number>;
}): OrderStatus | null {
  if (hasOpenShipment(input.shipments)) return null;
  if (isOrderFullyReturned(input.lines, input.shipments, input.acceptedAll)) {
    return hasDeliveredUnits(input.shipments) ? 'PARTIALLY_RETURNED' : 'RETURNED';
  }
  return hasDeliveredUnits(input.shipments) ? 'PARTIALLY_RETURNED' : null;
}

/** Order status after a remaining-goods signature on a partially returned box. */
export function orderStatusAfterSign(input: {
  lines: OrderLineSnapshot[];
  shipments: ShipmentSnapshot[];
  fullyShipped: boolean;
}): OrderStatus {
  if (hasOpenShipment(input.shipments)) return 'SHIPPING';
  if (hasDeliveredUnits(input.shipments)) {
    const returned = input.shipments.some(
      (box) => box.status === 'RETURNED' || box.status === 'PARTIALLY_RETURNED',
    );
    if (returned) return 'PARTIALLY_RETURNED';
  }
  return input.fullyShipped ? 'SIGNED' : 'SHIPPING';
}
