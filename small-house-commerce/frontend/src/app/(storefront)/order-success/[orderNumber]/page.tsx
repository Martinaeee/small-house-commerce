import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { PurchaseTracking } from "@/components/tracking/PurchaseTracking";
import { PreferredDateLine } from "@/components/checkout/PreferredDateLine";

export const metadata: Metadata = { title: "Order Received" };

/**
 * CHECKOUT_SPEC §21 Order Success. Deliberately says "Order Received", not
 * "Order Confirmed" — COD orders still require human confirmation.
 */
export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;

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
        <Link
          href={`/track-order?order=${orderNumber}`}
          className="text-sm text-cta hover:underline"
          data-testid="success-track-link"
        >
          Track your order
        </Link>
      </div>

      <p className="text-sm text-ink-muted">
        We will confirm your order by phone. Pay in cash when your furniture
        arrives.
      </p>

      <ButtonLink href="/collections" variant="secondary">
        Continue Shopping
      </ButtonLink>
      <Link href="/" className="text-sm text-cta hover:underline">
        Back to home
      </Link>
    </div>
  );
}
