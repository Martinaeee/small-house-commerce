import { cookies } from "next/headers";
import { serverApiUrl } from "./api";

/**
 * Success-page receipt: the checkout response sets an HttpOnly, path-scoped
 * cookie outside the URL, so the order number alone can never authorize the
 * page. The server component forwards that cookie to the backend, which
 * checks the signature and the database.
 */
export const ORDER_RECEIPT_COOKIE = "luwag_order_receipt";

export interface OrderReceipt {
  ok: true;
  placedAt: string;
}

export async function fetchOrderReceipt(orderNumber: string): Promise<OrderReceipt | null> {
  const token = (await cookies()).get(ORDER_RECEIPT_COOKIE)?.value;
  if (!token) return null;

  const response = await fetch(
    serverApiUrl(`/api/v1/storefront/orders/${encodeURIComponent(orderNumber)}/receipt`),
    {
      cache: "no-store",
      headers: { cookie: `${ORDER_RECEIPT_COOKIE}=${token}` },
    },
  );
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as Partial<OrderReceipt> | null;
  return body?.ok === true && typeof body.placedAt === "string" ? { ok: true, placedAt: body.placedAt } : null;
}
