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

const eyebrow =
  "text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--color-about-green)]";
const body = "text-[15px] leading-[1.75] text-[var(--color-about-ink)]";

export default function AboutPage() {
  const { story, why, promise, confidence, collection } = ABOUT_CONTENT;

  return (
    <div className="bg-[var(--color-about-bg)] text-[var(--color-about-ink)]">
      {/* 01 — Our Story: the promise, beside the room it is about. */}
      <section className="grid lg:h-[600px] lg:grid-cols-[62%_38%]">
        <div className="overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={story.image}
            alt={story.imageAlt}
            className="h-full w-full object-cover"
            style={{ aspectRatio: "3 / 2" }}
          />
        </div>
        <div className="flex flex-col justify-center px-5 py-14 sm:px-10 lg:px-14 xl:px-[72px]">
          <p className={eyebrow}>{story.eyebrow}</p>
          <h1
            className={`${storySerif.className} mt-5 text-[40px] leading-[1.1] text-[var(--color-about-ink)] sm:text-[50px] lg:text-[60px]`}
          >
            {story.headingLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h1>
          <p className={`mt-6 max-w-[46ch] text-[16px] leading-[1.7] ${body}`}>
            {story.body}
          </p>
          <span
            aria-hidden="true"
            className="mt-8 block h-px w-12 bg-[var(--color-about-brown)]"
          />
        </div>
      </section>

      {/* 02 — Why Luwag: the idea, the room, the three things it buys you. */}
      <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-10 lg:px-16 lg:py-28">
        {/* 32 / 40 / 28 of the row — in fr units so the gaps do not push the
            last column past the content edge. */}
        <div className="grid gap-10 lg:grid-cols-[1.15fr_1.45fr_1fr] lg:gap-12">
          <div className="lg:pt-4">
            <p className={eyebrow}>{why.eyebrow}</p>
            <h2
              className={`${storySerif.className} mt-5 text-[32px] leading-[1.16] text-[var(--color-about-ink)] sm:text-[38px] lg:text-[42px]`}
            >
              {why.headingLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h2>
            <p className={`mt-6 max-w-[42ch] ${body}`}>{why.body}</p>
          </div>
          <div className="overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={why.image}
              alt={why.imageAlt}
              className="h-full w-full object-cover"
              style={{ aspectRatio: "4 / 5" }}
            />
          </div>
          <ul className="flex flex-col justify-center gap-7">
            {why.values.map((value) => (
              <li key={value.title} className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-about-disc)] text-[var(--color-about-brown)]">
                  <LineIcon name={value.icon} />
                </span>
                <span>
                  <span className="block text-[15px] font-semibold text-[var(--color-about-ink)]">
                    {value.title}
                  </span>
                  <span className="mt-1 block text-[14px] leading-[1.6] text-[var(--color-about-muted)]">
                    {value.body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 03 — Our Promise: how a piece is made, in three numbered steps. */}
      <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
        {/* 25 / 75 of the row, in fr units for the same reason. */}
        <div className="grid gap-12 lg:grid-cols-[1fr_3fr] lg:gap-16">
          <div>
            <p className={eyebrow}>{promise.eyebrow}</p>
            <h2
              className={`${storySerif.className} mt-5 text-[30px] leading-[1.18] text-[var(--color-about-ink)] lg:text-[38px]`}
            >
              {promise.headingLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h2>
            <p className={`mt-6 max-w-[42ch] ${body}`}>{promise.body}</p>
            {promise.cta.href ? (
              <Link
                href={promise.cta.href}
                className="mt-8 inline-flex w-fit items-center gap-2 bg-[var(--color-about-green)] px-6 py-3 text-[14px] font-medium text-[var(--color-about-bg)] transition-opacity hover:opacity-90"
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
                className="mt-8 inline-flex w-fit cursor-default items-center gap-2 bg-[var(--color-about-green)] px-6 py-3 text-[14px] font-medium text-[var(--color-about-bg)] opacity-90"
              >
                {promise.cta.label}
                <span aria-hidden="true">→</span>
              </span>
            )}
          </div>
          <ol className="grid gap-6 sm:grid-cols-3">
            {promise.steps.map((step, index) => (
              <li key={step.title}>
                <div className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={step.image}
                    alt={step.imageAlt}
                    className="h-full w-full object-cover"
                    style={{ aspectRatio: "4 / 3" }}
                  />
                </div>
                <p
                  className={`${storySerif.className} mt-4 text-[22px] leading-none text-[var(--color-about-brown)]`}
                >
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-2 text-[15px] font-semibold text-[var(--color-about-ink)]">
                  {step.title}
                </h3>
                <p className="mt-2 text-[14px] leading-[1.6] text-[var(--color-about-muted)]">
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
        <div className="relative mx-auto max-w-[1440px] px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
          <p className={eyebrow}>{confidence.eyebrow}</p>
          <h2
            className={`${storySerif.className} mt-5 max-w-[18ch] text-[32px] leading-[1.16] text-[var(--color-about-ink)] lg:text-[44px]`}
          >
            {confidence.headingLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>
          {/* Two columns on phones, four on the desktop row. */}
          <ul className="mt-10 grid grid-cols-2 gap-x-6 gap-y-9 sm:gap-x-8 lg:max-w-[860px] lg:grid-cols-4">
            {confidence.services.map((service) => (
              <li key={service.title} className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 text-[var(--color-about-brown)]">
                  <LineIcon name={service.icon} />
                </span>
                <span>
                  <span className="block text-[14px] font-semibold text-[var(--color-about-ink)]">
                    {service.title}
                  </span>
                  <span className="mt-1 block text-[13px] leading-[1.6] text-[var(--color-about-muted)]">
                    {service.body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 05 — Explore the Collection: the one clear call to action. */}
      <section className="grid lg:grid-cols-[60%_40%]">
        <div className="overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={collection.image}
            alt={collection.imageAlt}
            className="h-full w-full object-cover"
            style={{ aspectRatio: "16 / 9" }}
          />
        </div>
        <div className="flex flex-col justify-center bg-[var(--color-about-green)] px-5 py-16 text-[var(--color-about-bg)] sm:px-12 lg:px-16 lg:py-24">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#c3cdb8]">
            {collection.eyebrow}
          </p>
          <h2
            className={`${storySerif.className} mt-5 text-[36px] leading-[1.14] lg:text-[48px]`}
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
              className="mt-9 inline-flex w-fit items-center gap-2 bg-[var(--color-about-bg)] px-7 py-3.5 text-[14px] font-medium text-[var(--color-about-green)] transition-opacity hover:opacity-90"
            >
              {collection.cta.label}
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
