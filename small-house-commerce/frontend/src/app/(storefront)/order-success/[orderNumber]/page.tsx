import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { PurchaseTracking } from "@/components/tracking/PurchaseTracking";
import { PreferredDateLine } from "@/components/checkout/PreferredDateLine";
import { OrderSuccessActions } from "@/components/checkout/OrderSuccessActions";
import { fetchOrderReceipt } from "@/lib/order-receipt";

export const metadata: Metadata = { title: "Order Received" };

/**
 * The success page is a capability page: the checkout response sets a signed,
 * HttpOnly receipt cookie, and only a matching order number plus a real,
 * non-cancelled order may render "Thank You". Without it the shopper gets a
 * neutral page that points at self-service tracking — so an arbitrary or
 * deleted order number can never confirm an order or fire a Purchase event.
 */
export const dynamic = "force-dynamic";

export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  const receipt = await fetchOrderReceipt(orderNumber).catch(() => null);
  if (!receipt) {
    return (
      <div className="mx-auto flex max-w-[600px] flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-3xl font-semibold text-ink">
          We couldn&apos;t display this order
        </h1>
        <p className="text-ink-secondary">
          Open your order with the number and mobile you used at checkout.
        </p>
        <ButtonLink href="/track-order" variant="secondary" className="w-full">
          Track your order
        </ButtonLink>
        <Link href="/" className="text-sm text-cta hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[600px] flex-col items-center gap-4 px-4 py-16 text-center">
      <PurchaseTracking orderNumber={orderNumber} />
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-light/50 text-3xl text-cta">
        ✓
      </span>
      <h1 className="text-3xl font-semibold text-ink">Thank You!</h1>
      <p className="text-ink-secondary">Your order has been received.</p>

      <div className="w-full rounded-lg border border-border bg-card p-6 text-left">
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Order Number</dt>
            <dd className="font-bold text-ink" data-testid="order-number">
              {orderNumber}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Payment</dt>
            <dd className="font-medium text-ink">Cash on Delivery</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Status</dt>
            <dd className="font-medium text-ink">Order Received</dd>
          </div>
        </dl>
        <PreferredDateLine />
      </div>

      <p className="text-sm text-ink-muted">
        We will confirm your order by phone. Pay in cash when your furniture
        arrives.
      </p>

      {/* Checking the order is what a shopper wants next, so it leads. */}
      <div className="flex w-full flex-col items-center gap-3">
        <OrderSuccessActions orderNumber={orderNumber} />
        <ButtonLink href="/collections" variant="secondary" className="w-full">
          Continue Shopping
        </ButtonLink>
        <Link href="/" className="text-sm text-cta hover:underline">
          Back to home
        </Link>
      </div>
    </div>
  );
}
