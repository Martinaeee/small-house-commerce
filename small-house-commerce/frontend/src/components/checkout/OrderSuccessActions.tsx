"use client";

import { ButtonLink } from "@/components/ui/Button";
import { useAuth } from "@/components/auth/AuthProvider";

/**
 * Post-order actions for the success page.
 *
 * The tracking entry point used to be a 14px text link at the bottom of the
 * summary card, which shoppers did not find; it is now a primary button. A
 * signed-in shopper additionally gets a direct link to their order list.
 *
 * `?order=` only prefills the order number — the track page still requires the
 * mobile number used at checkout, so this link never exposes an order to
 * someone who merely knows its number.
 */
export function OrderSuccessActions({ orderNumber }: { orderNumber: string }) {
  const { status } = useAuth();
  const authed = status === "authed";

  return (
    <>
      <ButtonLink
        href={authed ? "/account" : `/track-order?order=${orderNumber}`}
        className="w-full"
        data-testid="success-view-status"
      >
        {authed ? "View my orders" : "View order status"}
      </ButtonLink>
      {authed ? (
        <ButtonLink
          href={`/track-order?order=${orderNumber}`}
          variant="secondary"
          size="md"
          className="w-full"
          data-testid="success-track-link"
        >
          Track this order
        </ButtonLink>
      ) : null}
    </>
  );
}
