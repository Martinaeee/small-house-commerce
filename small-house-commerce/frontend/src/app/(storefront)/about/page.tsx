import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Our Story",
  description:
    "LUWAG Living makes furniture for small Filipino homes — the condos, apartments and rentals where every square meter counts.",
};

/**
 * The brand story page — the destination of the homepage brand-story CTA
 * ("A little more about luwag"). Copy follows BRAND_FOUNDATION_V1 §3.4
 * (long form) and §3.5 (trust bar): the three beats are the frustration with
 * big-house furniture, the space-smart products, and the maluwag reveal.
 */
const PILLARS = [
  {
    title: "Space-smart first",
    body: "Every piece has to justify itself on dimensions and function in a real small room — sofas that actually fit a condo wall, storage that climbs up instead of spreading out, desks that fold, beds with drawers underneath.",
  },
  {
    title: "Honestly affordable",
    body: "Fair fixed prices, no fake discounts. Maluwag sa budget is a claim we can prove, not a slogan we hope you believe.",
  },
  {
    title: "Calm and warm",
    body: "Japandi restraint, Filipino hospitality in the voice. Never cold-minimalist, never snobby — a helpful friend with good taste and a small condo.",
  },
  {
    title: "Renter-kind",
    body: "Easy assembly, no-drill options, light enough to move to the next apartment. Because most of us are not staying put.",
  },
];

const TRUST = [
  {
    title: "Made for 25–40 sqm homes",
    body: "Dimensions checked for condo rooms.",
  },
  {
    title: "₱199–₱3,999 lang",
    body: "Maluwag sa budget, fixed prices.",
  },
  {
    title: "Cash on Delivery",
    body: "Bayad pagdating, no card needed.",
  },
  {
    title: "Renter-friendly assembly",
    body: "Typically no drill, movable to your next place.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[900px] px-4 py-12 sm:px-6 md:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cta">
        Our Story
      </p>
      <h1 className="mt-3 text-3xl font-semibold leading-tight text-ink md:text-4xl">
        Maluwag ang bahay. Maluwag sa budget.
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-ink-secondary">
        LUWAG began with a simple frustration: furniture made for big houses,
        sold at prices small-home renters can&apos;t carry home. We pick every
        piece for the 25–40 sqm reality.
      </p>
      <p className="mt-4 leading-relaxed text-ink-secondary">
        We named it LUWAG, from <em>maluwag</em> — that sigh when you can
        finally move around your own room. Japandi-style calm, Filipino-friendly
        prices, delivered COD to your door. Luwag lang.
      </p>

      <h2 className="mt-12 text-2xl font-semibold text-ink">
        What we stand for
      </h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {PILLARS.map((pillar) => (
          <li
            key={pillar.title}
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5"
          >
            <h3 className="text-base font-semibold text-ink">{pillar.title}</h3>
            <p className="text-sm leading-relaxed text-ink-secondary">
              {pillar.body}
            </p>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 text-2xl font-semibold text-ink">
        What you can count on
      </h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {TRUST.map((item) => (
          <li key={item.title} className="flex flex-col gap-1">
            <span className="text-base font-semibold text-ink">{item.title}</span>
            <span className="text-sm text-ink-secondary">{item.body}</span>
          </li>
        ))}
      </ul>

      <div className="mt-12 flex flex-wrap items-center gap-4">
        <Link
          href="/collections"
          className="rounded-lg bg-cta px-5 py-3 text-sm font-semibold text-cta-foreground transition-colors hover:bg-cta-hover"
        >
          Shop small-space furniture
        </Link>
        <Link
          href="/"
          className="text-sm font-semibold text-cta hover:underline"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
