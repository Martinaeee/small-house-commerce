import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that govern orders, cash-on-delivery payment, delivery and returns at luwag.shop, including the governing law and how to contact LUWAG.",
  alternates: { canonical: "/terms" },
};

const SECTIONS = [
  {
    title: "About these terms",
    body: "By placing an order on luwag.shop you agree to these terms. The store is operated by LUWAG, an online furniture store for Filipino homes; our operating company is registered in Hong Kong SAR, and orders in the Philippines are fulfilled and supported locally from Bulacan.",
  },
  {
    title: "Orders",
    body: "An order you submit is a request to purchase. Our team confirms every order by phone or message before dispatch — please keep your phone reachable. Orders we cannot confirm within a reasonable time may be cancelled without charge.",
  },
  {
    title: "Prices and payment",
    body: "All prices are in Philippine pesos (₱) and include no hidden fees — the Total Due on Delivery shown at checkout is the exact cash amount to pay the courier. We currently accept cash on delivery only; online payment may be introduced later and will be clearly announced.",
  },
  {
    title: "Delivery",
    body: "We deliver nationwide within the timeframes published on our Shipping & Delivery page. Delivery times are good-faith estimates, not guarantees; weather and courier constraints in island and remote areas may cause delays beyond our control.",
  },
  {
    title: "Returns and refunds",
    body: "Items may be returned within 7 days of delivery under the conditions described on our Returns & Refunds page. Damaged, missing or wrong items are always replaced or refunded in full, including shipping.",
  },
  {
    title: "Acceptable use",
    body: "You agree not to place orders with false delivery information, not to abuse couriers, and not to misuse the store. We may refuse service to addresses or customers with a repeated record of refused deliveries.",
  },
  {
    title: "Liability",
    body: "Our liability for any order is limited to the amount you paid for it. We are not liable for indirect losses.",
  },
  {
    title: "Governing law",
    body: "These terms are governed by the laws of Hong Kong SAR, where our operating company is registered. Deliveries made within the Philippines remain subject to applicable Philippine consumer-protection regulations, and any dispute is first handled by our customer support team using the contact details below.",
  },
  {
    title: "Contact",
    body: "Questions about these terms — email hello@luwag.shop or call 0935 977 7504 (Mon–Sat, 9:00 AM–6:00 PM PHT).",
  },
];

export default function TermsOfServicePage() {
  return (
    <div className="bg-background">
      <header className="mx-auto max-w-[1200px] px-4 pt-10 sm:px-6 lg:pt-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-cta">
          Legal
        </p>
        <h1 className="mt-3 text-[clamp(26px,5vw,44px)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
          Terms of Service
        </h1>
        <p className="mt-3 max-w-[62ch] text-sm leading-6 text-ink-secondary">
          The terms that govern orders, cash-on-delivery payment, delivery and
          returns at luwag.shop. Effective 28 October 2026.
        </p>
      </header>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <div className="max-w-[78ch] space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="text-[clamp(18px,2.6vw,24px)] font-semibold tracking-[-0.01em] text-ink">
                {section.title}
              </h2>
              <p className="mt-2 text-sm leading-7 text-ink-secondary">
                {section.body}
              </p>
            </section>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6 lg:pb-14">
        <p className="text-sm leading-6 text-ink-secondary">
          Related policies:{" "}
          <Link
            href="/privacy"
            className="text-cta underline underline-offset-2"
          >
            Privacy Policy
          </Link>
          ,{" "}
          <Link
            href="/returns-refunds"
            className="text-cta underline underline-offset-2"
          >
            Returns &amp; Refunds
          </Link>{" "}
          and{" "}
          <Link
            href="/shipping-delivery"
            className="text-cta underline underline-offset-2"
          >
            Shipping &amp; Delivery
          </Link>
          . Questions about these terms? Use the{" "}
          <Link href="/contact" className="text-cta underline underline-offset-2">
            Contact Us
          </Link>{" "}
          details.
        </p>
      </section>
    </div>
  );
}
