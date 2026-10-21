import type { Metadata } from "next";
import Link from "next/link";
import { storySerif } from "@/lib/fonts";
import { ABOUT_CONTENT, type AboutIcon } from "./about-content";

export const metadata: Metadata = {
  title: "Our Story",
  description:
    "LUWAG Living makes furniture for small Filipino homes — the condos, apartments and rentals where every square meter counts.",
};

/**
 * The About Us page — the destination of the homepage brand-story CTA
 * ("A little more about luwag").
 *
 * Layout follows the approved design (1920px artboard, 1440px content): a
 * left-image/right-copy opening, an asymmetric three-column brand section, a
 * promise with three numbered steps, a service band and a closing call to
 * action on the brand green. The copy, photography and links live in
 * `about-content.ts`.
 *
 * A phone keeps the same side-by-side composition, but a row that would be
 * too cramped becomes a swipeable rail instead of a stack: every picture
 * keeps its own proportions (nothing is cropped) and the type scales with
 * the screen. The rails scroll with no visible scrollbar, and the text comes
 * first so the message never hides behind a swipe.
 *
 * Type: Prata (the brand's editorial serif) for the headings, the site's
 * sans-serif for the running copy and small labels. No shadows, no gradients
 * on the cards, no rounded containers — the design is flat.
 */
function LineIcon({ name }: { name: AboutIcon }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "home") {
    return (
      <svg {...common}>
        <path d="M3.5 10.5 12 3.5l8.5 7" />
        <path d="M6 9.6V20h12V9.6" />
        <path d="M9.8 20v-5.4h4.4V20" />
      </svg>
    );
  }
  if (name === "box") {
    return (
      <svg {...common}>
        <path d="M20.5 13.4 13 20.9a2 2 0 0 1-2.8 0L3 13.7V3.4h10.3l7.2 6.6a2 2 0 0 1 0 2.8Z" />
        <circle cx="7.4" cy="7.6" r="1.3" />
      </svg>
    );
  }
  if (name === "heart") {
    return (
      <svg {...common}>
        <path d="M12 20.2S4 15.3 4 10.4A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 8 2.8c0 4.9-8 9.8-8 9.8Z" />
      </svg>
    );
  }
  if (name === "truck") {
    return (
      <svg {...common}>
        <path d="M2.5 7.5h10.2v9.2H2.5z" />
        <path d="M12.7 11.2h4l2.8 3v2.5h-6.8z" />
        <circle cx="6.4" cy="18" r="1.7" />
        <circle cx="16.6" cy="18" r="1.7" />
      </svg>
    );
  }
  if (name === "bag") {
    return (
      <svg {...common}>
        <path d="M4.6 8h14.8l-1.1 12H5.7z" />
        <path d="M9 10V6.8a3 3 0 0 1 6 0V10" />
      </svg>
    );
  }
  if (name === "return") {
    return (
      <svg {...common}>
        <path d="M4 9h11a5 5 0 0 1 0 10H8" />
        <path d="M7.5 5.5 4 9l3.5 3.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 12a8 8 0 0 1 16 0v4.4a1.8 1.8 0 0 1-1.8 1.8H17v-5h-2.4v5H9.4v-5H7v5H5.8A1.8 1.8 0 0 1 4 16.4z" />
      <path d="M3.2 11.6 2 14M20.8 11.6 22 14" />
    </svg>
  );
}

/**
 * The type scale. The page is one design at two sizes: the clamp() middle
 * term follows the screen, so a 390px phone gets a scaled-down version of the
 * same layout rather than a different one.
 */
const type = {
  eyebrow: "text-[10px] tracking-[0.16em] lg:text-[11px] lg:tracking-[0.2em]",
  storyHeading: "text-[clamp(21px,5.4vw,60px)] lg:leading-[1.1]",
  sectionHeading: "text-[clamp(15px,4vw,42px)] lg:leading-[1.16]",
  promiseHeading: "text-[clamp(15px,4.2vw,38px)] lg:leading-[1.18]",
  collectionHeading: "text-[clamp(19px,5vw,48px)] lg:leading-[1.14]",
  body: "text-[clamp(12.5px,2.5vw,16px)] lg:text-[15px] lg:leading-[1.75]",
  lead: "text-[clamp(12px,2.3vw,16px)] lg:text-[16px] lg:leading-[1.7]",
  label: "text-[clamp(11px,1.9vw,15px)] lg:text-[15px]",
  small: "text-[clamp(10.5px,1.8vw,14px)] lg:text-[14px]",
  tiny: "text-[clamp(10px,1.6vw,13px)] lg:text-[13px]",
};

/** A row that is too tight on a phone: swipeable, no visible scrollbar. */
const rail =
  "flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid lg:overflow-visible lg:gap-0";

export default function AboutPage() {
  const { story, why, promise, confidence, collection } = ABOUT_CONTENT;

  return (
    <div className="bg-[var(--color-about-bg)] text-[var(--color-about-ink)]">
      {/* 01 — Our Story: the promise, beside the room it is about. */}
      <section className={`${rail} lg:h-[600px] lg:grid-cols-[62%_38%]`}>
        <div className="order-1 flex w-[260px] shrink-0 snap-start flex-col justify-center px-5 py-10 lg:order-2 lg:w-auto lg:px-14 lg:py-0 xl:px-[72px]">
          <p
            className={`${type.eyebrow} font-medium uppercase text-[var(--color-about-green)]`}
          >
            {story.eyebrow}
          </p>
          <h1
            className={`${storySerif.className} ${type.storyHeading} mt-3 leading-[1.14] text-[var(--color-about-ink)] lg:mt-5`}
          >
            {story.headingLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h1>
          <p
            className={`${type.lead} mt-3 max-w-[46ch] leading-[1.65] text-[var(--color-about-ink)] lg:mt-6`}
          >
            {story.body}
          </p>
          <span
            aria-hidden="true"
            className="mt-4 block h-px w-8 bg-[var(--color-about-brown)] lg:mt-8 lg:w-12"
          />
        </div>
        <div className="order-2 w-[330px] shrink-0 snap-start lg:order-1 lg:h-[600px] lg:w-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={story.image}
            alt={story.imageAlt}
            className="aspect-[3/2] h-auto w-full object-cover lg:h-full lg:aspect-auto"
          />
        </div>
      </section>

      {/* 02 — Why Luwag: the idea, the room, the three things it buys you. */}
      <section className="mx-auto max-w-[1440px] px-5 py-10 sm:px-10 lg:px-16 lg:py-28">
        <div className={`${rail} lg:grid-cols-[1.15fr_1.45fr_1fr] lg:gap-12`}>
          <div className="w-[220px] shrink-0 snap-start lg:w-auto lg:pt-4">
            <p
              className={`${type.eyebrow} font-medium uppercase text-[var(--color-about-green)]`}
            >
              {why.eyebrow}
            </p>
            <h2
              className={`${storySerif.className} ${type.sectionHeading} mt-3 leading-[1.18] text-[var(--color-about-ink)] lg:mt-5`}
            >
              {why.headingLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h2>
            <p
              className={`${type.body} mt-3 max-w-[42ch] leading-[1.65] text-[var(--color-about-ink)] lg:mt-6`}
            >
              {why.body}
            </p>
          </div>
          <div className="w-[320px] shrink-0 snap-start lg:w-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={why.image}
              alt={why.imageAlt}
              className="aspect-[3/2] h-auto w-full object-cover lg:h-full lg:aspect-[4/5]"
            />
          </div>
          <ul className="flex w-[230px] shrink-0 snap-start flex-col justify-center gap-4 lg:w-auto lg:gap-7">
            {why.values.map((value) => (
              <li key={value.title} className="flex items-start gap-2 lg:gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-about-disc)] text-[var(--color-about-brown)] lg:h-11 lg:w-11">
                  <span className="[&>svg]:h-3.5 [&>svg]:w-3.5 lg:[&>svg]:h-5 lg:[&>svg]:w-5">
                    <LineIcon name={value.icon} />
                  </span>
                </span>
                <span className="min-w-0">
                  <span
                    className={`${type.small} block font-semibold leading-[1.35] text-[var(--color-about-ink)]`}
                  >
                    {value.title}
                  </span>
                  <span
                    className={`${type.tiny} mt-0.5 block leading-[1.45] text-[var(--color-about-muted)]`}
                  >
                    {value.body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 03 — Our Promise: how a piece is made, in three numbered steps. */}
      <section className="mx-auto max-w-[1440px] px-5 py-10 sm:px-10 lg:px-16 lg:py-24">
        <div className={`${rail} lg:grid-cols-[1fr_3fr] lg:gap-16`}>
          <div className="w-[220px] shrink-0 snap-start lg:w-auto">
            <p
              className={`${type.eyebrow} font-medium uppercase text-[var(--color-about-green)]`}
            >
              {promise.eyebrow}
            </p>
            <h2
              className={`${storySerif.className} ${type.promiseHeading} mt-3 leading-[1.2] text-[var(--color-about-ink)] lg:mt-5`}
            >
              {promise.headingLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h2>
            <p
              className={`${type.body} mt-3 max-w-[42ch] leading-[1.65] text-[var(--color-about-ink)] lg:mt-6`}
            >
              {promise.body}
            </p>
            {promise.cta.href ? (
              <Link
                href={promise.cta.href}
                className="mt-5 inline-flex w-fit items-center gap-2 bg-[var(--color-about-green)] px-3 py-2 text-[11px] font-medium text-[var(--color-about-bg)] transition-opacity hover:opacity-90 lg:mt-8 lg:px-6 lg:py-3 lg:text-[14px]"
              >
                {promise.cta.label}
                <span aria-hidden="true">→</span>
              </Link>
            ) : (
              // No manufacturing page exists yet, so the button stays a
              // destination-less placeholder instead of a dead link.
              <span
                data-pending-href="manufacturing"
                aria-disabled="true"
                title="Link pending — the manufacturing page is not published yet"
                className="mt-5 inline-flex w-fit cursor-default items-center gap-2 bg-[var(--color-about-green)] px-3 py-2 text-[11px] font-medium text-[var(--color-about-bg)] opacity-90 lg:mt-8 lg:px-6 lg:py-3 lg:text-[14px]"
              >
                {promise.cta.label}
                <span aria-hidden="true">→</span>
              </span>
            )}
          </div>
          {/* The three steps are the rail items on a phone and three equal
              columns on the desktop. Their pictures keep their 4:3 shape. */}
          <ol className="contents lg:grid lg:grid-cols-3 lg:gap-6">
            {promise.steps.map((step, index) => (
              <li
                key={step.title}
                className="w-[240px] shrink-0 snap-start lg:w-auto"
              >
                <div className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={step.image}
                    alt={step.imageAlt}
                    className="aspect-[4/3] h-auto w-full object-cover lg:aspect-[4/3]"
                  />
                </div>
                <p
                  className={`${storySerif.className} mt-3 text-[clamp(15px,3.4vw,22px)] leading-none text-[var(--color-about-brown)] lg:mt-4`}
                >
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3
                  className={`${type.label} mt-1 font-semibold leading-[1.35] text-[var(--color-about-ink)] lg:mt-2`}
                >
                  {step.title}
                </h3>
                <p
                  className={`${type.tiny} mt-1 leading-[1.5] text-[var(--color-about-muted)] lg:mt-2`}
                >
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 04 — Shopping With Confidence: the service band, fading into the
          packaging photograph on the right. */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] lg:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={confidence.image}
            alt=""
            className="h-full w-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-r from-[var(--color-about-bg)] via-[var(--color-about-bg)]/55 to-transparent"
          />
        </div>
        <div className="relative mx-auto max-w-[1440px] px-5 py-10 sm:px-10 lg:px-16 lg:py-24">
          <div className={`${rail} lg:block`}>
            <div className="w-[250px] shrink-0 snap-start lg:w-auto">
              <p
                className={`${type.eyebrow} font-medium uppercase text-[var(--color-about-green)]`}
              >
                {confidence.eyebrow}
              </p>
              <h2
                className={`${storySerif.className} ${type.sectionHeading} mt-3 max-w-none leading-[1.18] text-[var(--color-about-ink)] lg:mt-5 lg:max-w-[18ch]`}
              >
                {confidence.headingLines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </h2>
              <ul className="mt-5 flex flex-col gap-3 lg:mt-10 lg:max-w-[860px] lg:grid lg:grid-cols-4 lg:gap-x-8 lg:gap-y-9">
                {confidence.services.map((service) => (
                  <li key={service.title} className="flex items-start gap-2 lg:gap-3">
                    <span className="mt-0.5 shrink-0 text-[var(--color-about-brown)] [&>svg]:h-4 [&>svg]:w-4 lg:[&>svg]:h-5 lg:[&>svg]:w-5">
                      <LineIcon name={service.icon} />
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`${type.small} block font-semibold leading-[1.35] text-[var(--color-about-ink)]`}
                      >
                        {service.title}
                      </span>
                      <span
                        className={`${type.tiny} mt-0.5 block leading-[1.5] text-[var(--color-about-muted)]`}
                      >
                        {service.body}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {/* On a phone the packaging photograph joins the row as another
                swipeable piece instead of a cropped sliver. */}
            <div className="w-[330px] shrink-0 snap-start lg:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={confidence.image}
                alt=""
                className="aspect-[3/2] h-auto w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 05 — Explore the Collection: the one clear call to action. */}
      <section className={`${rail} lg:grid-cols-[60%_40%]`}>
        <div className="order-1 w-[260px] shrink-0 snap-start bg-[var(--color-about-green)] px-5 py-10 text-[var(--color-about-bg)] lg:order-2 lg:flex lg:w-auto lg:flex-col lg:justify-center lg:px-16 lg:py-24">
          <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-[#c3cdb8] lg:text-[11px] lg:tracking-[0.2em]">
            {collection.eyebrow}
          </p>
          <h2
            className={`${storySerif.className} ${type.collectionHeading} mt-3 leading-[1.16] lg:mt-5`}
          >
            {collection.headingLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>
          {collection.cta.href ? (
            <Link
              href={collection.cta.href}
              className="mt-5 inline-flex w-fit items-center gap-1.5 bg-[var(--color-about-bg)] px-4 py-2.5 text-[12px] font-medium text-[var(--color-about-green)] transition-opacity hover:opacity-90 lg:mt-9 lg:gap-2 lg:px-7 lg:py-3.5 lg:text-[14px]"
            >
              {collection.cta.label}
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
        <div className="order-2 w-[330px] shrink-0 snap-start lg:order-1 lg:w-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={collection.image}
            alt={collection.imageAlt}
            className="aspect-[16/9] h-auto w-full object-cover lg:h-full lg:aspect-auto"
          />
        </div>
      </section>
    </div>
  );
}
