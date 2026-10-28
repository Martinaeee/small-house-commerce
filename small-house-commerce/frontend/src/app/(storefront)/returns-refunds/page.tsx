import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Returns & Refunds",
  description:
    "LUWAG returns and refunds: check the parcel before you pay, refuse damaged or wrong items at the door, return unused items within 7 days, report damage within 48 hours, and receive refunds by GCash, Maya or bank transfer.",
  alternates: { canonical: "/returns-refunds" },
};

const CHECK_BEFORE_PAY = [
  {
    title: "Inspect before you pay",
    body: "Cash on delivery means you see the parcel first. In front of the courier, check the label, the box and the piece itself. If anything is broken, missing or not what you ordered, you may refuse the parcel.",
  },
  {
    title: "Refusing is not a penalty",
    body: "Refusing a damaged or wrong parcel is not treated as a cancelled order. Nothing is charged, and our team contacts you to arrange a replacement or discuss a refund.",
  },
  {
    title: "We take the parcel back",
    body: "The courier returns the refused parcel to us. Keep the waybill or the courier reference if you can — it helps us close the return faster.",
  },
];

const POLICY = [
  {
    title: "7-day returns",
    body: "You may return any item within 7 days of delivery if it is unused, in its original packaging, with all parts, accessories and free gifts included. Contact us first — by phone, email or Messenger — so we can register the return and tell you how to send it back.",
  },
  {
    title: "Damaged, missing or wrong items",
    body: "If the order arrives damaged, with missing parts, or is not the item you ordered, send us a photo or video within 48 hours of delivery. We ship a free replacement or issue a full refund including delivery — your choice.",
  },
  {
    title: "Refunds",
    body: "Orders are paid in cash on delivery, so refunds are sent by GCash, Maya or bank transfer within 5 working days after the returned item passes our warehouse check. When the return is due to our error or a damaged item, delivery fees are refunded in full.",
  },
  {
    title: "Exchanges",
    body: "Prefer a different piece? Within the same 7 days we can exchange instead of refunding, subject to stock. If the replacement costs more, we tell you the difference before anything is charged.",
  },
  {
    title: "Warranty and after-sales",
    body: "Structural and manufacturing issues reported within 30 days of delivery are covered: we provide replacement parts or a replacement unit free of charge. Damage caused by misuse or by assembly that departs from the instructions is not covered.",
  },
  {
    title: "What we cannot take back",
    body: "Items returned after 7 days without prior contact, items damaged by misuse, and assembled or used furniture without its original packaging may be refused or partially refunded after our team inspects them.",
  },
  {
    title: "Who pays return shipping",
    body: "If the return is our fault — damaged, wrong or missing item — we cover the return shipping. For change-of-mind returns you arrange and pay the return shipping, and we quote it before you send anything.",
  },
];

const FAQ = [
  {
    question: "How do I start a return?",
    answer:
      "Contact us with your order number and the mobile number you ordered with — email hello@luwag.shop or call 0935 977 7504 (Mon–Sat, 9:00 AM–6:00 PM PHT). Our team registers the return and gives you the courier instructions. You can check your order any time on the Track Order page.",
  },
  {
    question: "Can I refuse the parcel at the door?",
    answer:
      "Yes. If the parcel is damaged, incomplete or not what you ordered, refuse it in front of the courier. Nothing is charged and our team follows up to send a replacement or refund.",
  },
  {
    question: "How long does a refund take?",
    answer:
      "Refunds are issued within 5 working days after the returned item passes our warehouse check, by GCash, Maya or bank transfer. We contact you first to confirm the refund details.",
  },
  {
    question: "Do I need to keep the packaging?",
    answer:
      "Yes for change-of-mind returns: the item must come back unused, in its original packaging with all parts. Keep the packaging until you are sure you are keeping the piece.",
  },
  {
    question: "What if the item was already assembled?",
    answer:
      "Assembled or used furniture cannot be returned for a change of mind, but manufacturing defects are still covered by the 30-day warranty described above.",
  },
  {
    question: "Can I exchange instead of refunding?",
    answer:
      "Yes, within 7 days of delivery and subject to stock. Contact us first so we can hold the replacement and confirm any price difference before charging.",
  },
];

export default function ReturnsRefundsPage() {
  return (
    <div className="bg-background">
      <header className="mx-auto max-w-[1200px] px-4 pt-10 sm:px-6 lg:pt-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-cta">
          Returns
        </p>
        <h1 className="mt-3 text-[clamp(26px,5vw,44px)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
          Returns &amp; Refunds
        </h1>
        <p className="mt-3 max-w-[62ch] text-sm leading-6 text-ink-secondary">
          Orders are paid in cash when they arrive, so you can check the parcel
          before you pay. If something is wrong, we replace it or refund you —
          here are the rules in plain words. Effective 28 October 2026.
        </p>
      </header>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <h2 className="text-[clamp(20px,3.4vw,30px)] font-semibold tracking-[-0.02em] text-ink">
          Before you pay
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {CHECK_BEFORE_PAY.map((step, index) => (
            <div
              key={step.title}
              className="rounded-xl border border-border bg-card p-5"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cta">
                Step {index + 1}
              </span>
              <h3 className="mt-2 text-base font-semibold text-ink">
                {step.title}
              </h3>
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
            Returns &amp; refunds policy
          </h2>
          <div className="mt-8 max-w-[78ch] space-y-8">
            {POLICY.map((section) => (
              <section key={section.title}>
                <h3 className="text-[clamp(18px,2.6vw,24px)] font-semibold tracking-[-0.01em] text-ink">
                  {section.title}
                </h3>
                <p className="mt-2 text-sm leading-7 text-ink-secondary">
                  {section.body}
                </p>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
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
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">
              Need to start a return?
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-ink-secondary">
              Message us with your order number and the mobile number you
              ordered with.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/contact"
              className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-cta-foreground"
            >
              Contact us
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
