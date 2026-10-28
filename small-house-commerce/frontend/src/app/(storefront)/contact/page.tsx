import type { Metadata } from "next";
import Link from "next/link";
import { fetchSiteSettings } from "@/lib/site-settings";

export const metadata: Metadata = {
  title: "Contact Us",
  description:
    "Contact LUWAG: email hello@luwag.shop, call or message 0935 977 7504 (Mon–Sat, 9:00 AM–6:00 PM PHT), or track your order online. Serving customers across the Philippines.",
  alternates: { canonical: "/contact" },
};

const STORE_EMAIL = "hello@luwag.shop";
const STORE_PHONE = "0935 977 7504";
const STORE_PHONE_HREF = "09359777504";
const STORE_HOURS = "Mon–Sat, 9:00 AM–6:00 PM (PHT)";
const STORE_ADDRESS = "Bulacan, Philippines";

export default async function ContactPage() {
  const { messengerUrl } = await fetchSiteSettings();
  const messenger = messengerUrl.trim();

  return (
    <div className="bg-background">
      <header className="mx-auto max-w-[1200px] px-4 pt-10 sm:px-6 lg:pt-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-cta">
          Support
        </p>
        <h1 className="mt-3 text-[clamp(26px,5vw,44px)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
          Contact Us
        </h1>
        <p className="mt-3 max-w-[62ch] text-sm leading-6 text-ink-secondary">
          A real person answers every message. The fastest way to reach us
          about an order is by phone or Messenger — have your order number and
          the mobile number you ordered with ready.
        </p>
      </header>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-ink">Email</h2>
            <a
              href={`mailto:${STORE_EMAIL}`}
              className="mt-2 inline-block text-sm font-medium text-cta underline underline-offset-2"
            >
              {STORE_EMAIL}
            </a>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              We reply within one working day.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-ink">Phone</h2>
            <a
              href={`tel:${STORE_PHONE_HREF}`}
              className="mt-2 inline-block text-sm font-medium text-cta underline underline-offset-2"
            >
              {STORE_PHONE}
            </a>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              Call or text during support hours.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-ink">Support hours</h2>
            <p className="mt-2 text-sm font-medium text-ink">{STORE_HOURS}</p>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              Messages sent outside these hours are answered the next working
              morning.
            </p>
          </div>
          {messenger ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-base font-semibold text-ink">Messenger</h2>
              <a
                href={messenger}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm font-medium text-cta underline underline-offset-2"
              >
                Message us on Messenger
              </a>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                Best for quick order questions and delivery updates.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
          <h2 className="text-[clamp(20px,3.4vw,30px)] font-semibold tracking-[-0.02em] text-ink">
            Company information
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">Store</h3>
              <p className="mt-1.5 text-sm leading-6 text-ink-secondary">
                LUWAG — online furniture for Filipino condos and rentals,
                operating luwag.shop.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Address</h3>
              <p className="mt-1.5 text-sm leading-6 text-ink-secondary">
                {STORE_ADDRESS}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Operating company</h3>
              <p className="mt-1.5 text-sm leading-6 text-ink-secondary">
                Our operating company is registered in Hong Kong SAR. Orders in
                the Philippines are fulfilled and supported locally from
                Bulacan.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Orders and returns</h3>
              <p className="mt-1.5 text-sm leading-6 text-ink-secondary">
                Check delivery times on{" "}
                <Link
                  href="/shipping-delivery"
                  className="text-cta underline underline-offset-2"
                >
                  Shipping &amp; Delivery
                </Link>{" "}
                and the return rules on{" "}
                <Link
                  href="/returns-refunds"
                  className="text-cta underline underline-offset-2"
                >
                  Returns &amp; Refunds
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">
              Looking for your parcel?
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-ink-secondary">
              Track it with your order number and the mobile number you ordered
              with.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/track-order"
              className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-cta-foreground"
            >
              Track my order
            </Link>
            <Link
              href="/privacy"
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink"
            >
              Privacy Policy
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
