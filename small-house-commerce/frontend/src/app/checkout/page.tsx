import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Checkout" };

/**
 * Placeholder checkout page for slice 2 — the full COD checkout form lands
 * with the cart slice (FRONTEND_SPEC §14, CHECKOUT_SPEC).
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ skuId?: string; qty?: string }>;
}) {
  const { skuId, qty } = await searchParams;

  return (
    <div className="mx-auto flex max-w-[600px] flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-3xl font-semibold text-ink">Checkout</h1>
      <p className="text-ink-secondary">
        {skuId
          ? `Preparing your order (SKU ${skuId.slice(0, 8)}${qty ? ` × ${qty}` : ""})…`
          : "Your cart is ready."}
      </p>
      <p className="text-sm text-ink-muted">
        The COD checkout form is the next slice. Use the cart meanwhile.
      </p>
      <Link href="/" className="text-sm text-cta hover:underline">
        Back to shopping
      </Link>
    </div>
  );
}
