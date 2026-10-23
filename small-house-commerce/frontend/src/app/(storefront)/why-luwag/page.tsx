import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Why LUWAG",
  description:
    "Service you can count on and how our pieces are made — from our factory drawings to your door, with cash on delivery and real support in the Philippines.",
  alternates: { canonical: "/why-luwag" },
};

const SERVICE = [
  {
    title: "Cash on delivery, nationwide",
    body: "You pay the courier when the order arrives — no advance payment, no card details, no waiting for a bank transfer to clear.",
  },
  {
    title: "Real updates, from a person",
    body: "Our team calls you about your order instead of leaving you to check an app. If something changes, you hear it from us.",
  },
  {
    title: "7-day free return",
    body: "If the piece is not right for your space, you can return it within seven days — a small-space purchase should not be a permanent one.",
  },
  {
    title: "Support you can actually reach",
    body: "Monday to Saturday, 9am to 6pm Philippine time, at support@luwag.ph. A real person reads every message.",
  },
];

const FACTORY = [
  {
    title: "We work with our factory directly",
    body: "Our pieces are made to our own drawings, on a production line we work with every week. No reseller sits between the factory and your order, so the price you see is the price we make.",
  },
  {
    title: "Drawn for the room you live in",
    body: "A condo bedroom is not a showroom. Our tall cabinet is 121.5 cm high and 11 inches deep on purpose: it clears a standard ceiling and a narrow wall, and it still holds what a full-size wardrobe would.",
  },
  {
    title: "Checked before it is boxed",
    body: "Each piece is checked before packing, and the parts that wear out — slides, hinges, screws — are standard sizes, so they can be replaced instead of the whole unit.",
  },
  {
    title: "Packed for Philippine roads",
    body: "Boxes are built for the trip: protected corners, hardware bagged separately, and the order number on the box so the courier can match it on arrival.",
  },
];

export default function WhyLuwagPage() {
  return (
    <div className="bg-background">
      <header className="mx-auto max-w-[1200px] px-4 pt-10 sm:px-6 lg:pt-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-cta">
          Why LUWAG
        </p>
        <h1 className="mt-3 text-[clamp(26px,5vw,44px)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
          Service you can count on, made by people we know
        </h1>
        <p className="mt-3 max-w-[62ch] text-sm leading-6 text-ink-secondary">
          Small-space furniture is a promise: it has to fit, arrive on time,
          and be worth the money when it does. Here is how we keep that promise
          — the service side and the factory side.
        </p>
      </header>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <h2 className="text-[clamp(20px,3.4vw,30px)] font-semibold tracking-[-0.02em] text-ink">
          The service side
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {SERVICE.map((entry) => (
            <div
              key={entry.title}
              className="rounded-xl border border-border bg-card p-5"
            >
              <h3 className="text-base font-semibold text-ink">{entry.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                {entry.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
          <h2 className="text-[clamp(20px,3.4vw,30px)] font-semibold tracking-[-0.02em] text-ink">
            The factory side
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {FACTORY.map((entry) => (
              <div
                key={entry.title}
                className="rounded-xl border border-border bg-background p-5"
              >
                <h3 className="text-base font-semibold text-ink">
                  {entry.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">
                  {entry.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">
              See how the pieces arrive
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-ink-secondary">
              Delivery details, cost and tracking — all in one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/shipping-delivery"
              className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-cta-foreground"
            >
              Shipping &amp; delivery
            </Link>
            <Link
              href="/collections/small-space-solutions"
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink"
            >
              Shop small-space solutions
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
