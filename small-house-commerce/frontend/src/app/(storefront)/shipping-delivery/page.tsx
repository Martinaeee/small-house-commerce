import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Shipping & Delivery",
  description:
    "How LUWAG delivers nationwide: Metro Manila in 3–5 working days, provinces in 5–7, cash on delivery, and how to track your order.",
  alternates: { canonical: "/shipping-delivery" },
};

const STEPS = [
  {
    title: "We confirm your order",
    body: "Our team checks the item, confirms the delivery address and the contact number, then tells you the expected day. Nothing is charged before it ships.",
  },
  {
    title: "It is packed and checked",
    body: "Each piece is packed for the trip: corners protected, hardware in its own bag, and the box labelled with your order number so the courier can match it on arrival.",
  },
  {
    title: "The courier calls before delivery",
    body: "Expect a call or a text from the courier. Someone should be there to receive the parcel and pay the courier.",
  },
  {
    title: "Pay on arrival",
    body: "Cash on delivery nationwide: the courier collects the exact amount when the order reaches you. Check the parcel before you pay — see below if something is wrong.",
  },
];

const FAQ = [
  {
    question: "How long does delivery take?",
    answer:
      "Metro Manila is 3–5 working days, and the rest of the Philippines is 5–7 working days, counted from the day your order is confirmed. Island and remote areas can take a few days longer, and heavy weather slows every courier in the country.",
  },
  {
    question: "What does delivery cost?",
    answer:
      "Delivery in Metro Manila is free on orders of ₱3,000 and up. Outside Metro Manila the rate depends on the destination and the size of the parcel — message us before you order and we will confirm it, so nothing is added that you did not agree to.",
  },
  {
    question: "Can I pay online instead?",
    answer:
      "Cash on delivery is our default and it is available everywhere we deliver. If you would rather pay in advance, message us with your order number and we will send the available options for your area.",
  },
  {
    question: "What if nobody is home?",
    answer:
      "The courier will contact you first. If the parcel cannot be received, it goes back to us and we will rearrange delivery with you — we will not leave a paid order sitting in a warehouse.",
  },
  {
    question: "What if the parcel arrives damaged?",
    answer:
      "Please check the box in front of the courier before paying. If something is broken or missing, refuse the parcel or accept it and tell us within 24 hours with a photo, and we will make it right.",
  },
  {
    question: "How do I track my order?",
    answer:
      "Use your order number and the mobile number you ordered with. Our team also updates you by phone when the parcel moves.",
  },
];

export default function ShippingDeliveryPage() {
  return (
    <div className="bg-background">
      <header className="mx-auto max-w-[1200px] px-4 pt-10 sm:px-6 lg:pt-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-cta">
          Delivery
        </p>
        <h1 className="mt-3 text-[clamp(26px,5vw,44px)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
          Shipping &amp; Delivery
        </h1>
        <p className="mt-3 max-w-[62ch] text-sm leading-6 text-ink-secondary">
          We deliver nationwide and you pay when the order arrives. Here is
          exactly how your order travels from our packing table to your door.
        </p>
      </header>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <div
              key={step.title}
              className="rounded-xl border border-border bg-card p-5"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cta">
                Step {index + 1}
              </span>
              <h2 className="mt-2 text-base font-semibold text-ink">
                {step.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
          <h2 className="text-[clamp(20px,3.4vw,30px)] font-semibold tracking-[-0.02em] text-ink">
            Questions we hear most
          </h2>
          <dl className="mt-6 grid gap-x-10 gap-y-6 lg:grid-cols-2">
            {FAQ.map((entry) => (
              <div key={entry.question}>
                <dt className="text-sm font-semibold text-ink">
                  {entry.question}
                </dt>
                <dd className="mt-1.5 text-sm leading-6 text-ink-secondary">
                  {entry.answer}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">
              Still deciding? Start with the collections.
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-ink-secondary">
              Every piece ships the same way, wherever you are.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/collections/new-arrivals"
              className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-cta-foreground"
            >
              Shop new arrivals
            </Link>
            <Link
              href="/track-order"
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink"
            >
              Track my order
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
