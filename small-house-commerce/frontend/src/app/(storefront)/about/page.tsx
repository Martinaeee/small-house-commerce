import type { Metadata } from "next";
import Link from "next/link";
import { storySerif } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Our Story",
  description:
    "LUWAG Living makes furniture for small Filipino homes — the condos, apartments and rentals where every square meter counts.",
};

/**
 * The brand story page — the destination of the homepage brand-story CTA
 * ("A little more about luwag").
 *
 * The page follows the approved brand mockups, stacked in order:
 *   1. OUR STORY   — the promise, next to the room it is about.
 *   2. WHY LUWAG  — the idea, a photo, and the three things it buys you.
 *   3. OUR PROMISE — how a piece is made, in three numbered steps.
 *   4. GOOD LIVING — what every order comes with.
 *   5. THE COLLECTION — the closing call to action on a deep green panel.
 *
 * Type follows the homepage brand-story block: Prata for the headings and
 * the running copy, letter-spaced Poppins for the eyebrows, the numbers and
 * the buttons. The photos are the store's own product and room photography.
 */
const PHOTOS = {
  room: "/uploads/catalog/2026/97393250-7f9f-4be0-893a-d6edbad54584.png",
  desk: "/uploads/catalog/2026/0b5be1d5-9304-4a74-b861-c0b1d2da47e7.png",
  wood: "/uploads/catalog/2026/b6a876d1-b037-4e62-af41-31a5c4a313b8.png",
  chair: "/uploads/catalog/2026/25843018-1e33-4d3a-a427-4691553bed43.png",
  cabinet: "/uploads/catalog/2026/7ff127b3-8e15-4602-8e3d-5619bc8097af.png",
  essentials: "/uploads/catalog/2026/80c6b716-71e5-415f-93be-ab08ea158529.png",
  collection: "/uploads/catalog/2026/070290dc-0c63-4cfc-bab3-61f15ec2d0f3.png",
};

/** The three reasons the brand exists, each with a small line icon. */
const REASONS = [
  {
    icon: "home",
    title: "Designed for real homes",
    body: "Thoughtful solutions for small spaces.",
  },
  {
    icon: "tag",
    title: "Practical & versatile",
    body: "Furniture that works harder in your home.",
  },
  {
    icon: "heart",
    title: "A more comfortable everyday",
    body: "Because a well-organized home feels like home.",
  },
];

/** How a piece gets from the supplier to the customer's door. */
const STEPS = [
  {
    image: PHOTOS.wood,
    title: "Carefully selected materials",
    body: "We use quality materials sourced from trusted suppliers.",
  },
  {
    image: PHOTOS.chair,
    title: "Skilled production & quality checks",
    body: "Each piece is inspected by hand before it is packed and ready to ship.",
  },
  {
    image: PHOTOS.cabinet,
    title: "Secure packaging & delivery",
    body: "We pack with care — so your furniture arrives safely and on time.",
  },
];

/** What every order carries, beyond the furniture itself. */
const ESSENTIALS = [
  { icon: "truck", label: "Ships across Metro Manila" },
  { icon: "wrench", label: "Easy assembly" },
  { icon: "clock", label: "1-Day delivery" },
  { icon: "chat", label: "Customer support" },
];

function LineIcon({ name }: { name: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "home") {
    return (
      <svg {...common}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5.5 9.5V20h13V9.5" />
        <path d="M10 20v-5.5h4V20" />
      </svg>
    );
  }
  if (name === "tag") {
    return (
      <svg {...common}>
        <path d="M20.5 13.5 13 21a2 2 0 0 1-2.8 0L3 13.8V3h10.8L20.5 9.7a2 2 0 0 1 0 2.8Z" />
        <circle cx="7.5" cy="7.5" r="1.2" />
      </svg>
    );
  }
  if (name === "heart") {
    return (
      <svg {...common}>
        <path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 3c0 4.8-7.5 9.4-7.5 9.4Z" />
      </svg>
    );
  }
  if (name === "truck") {
    return (
      <svg {...common}>
        <path d="M2.5 7.5h10v9h-10z" />
        <path d="M12.5 11h4l3 3v2.5h-7z" />
        <circle cx="6.5" cy="18" r="1.6" />
        <circle cx="16.5" cy="18" r="1.6" />
      </svg>
    );
  }
  if (name === "wrench") {
    return (
      <svg {...common}>
        <path d="M14.5 3.5a5 5 0 0 0-5.8 6.4L3 15.6 5.4 18l5.7-5.7a5 5 0 0 0 6.4-5.8l-3 3-2.2-.6-.6-2.2 3-3Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 12a8 8 0 0 1 16 0v4.5a2 2 0 0 1-2 2h-1v-5h-2v5H9v-5H7v5H6a2 2 0 0 1-2-2Z" />
      <path d="M3 11.5 2 14M21 11.5 22 14" />
    </svg>
  );
}

export default function AboutPage() {
  return (
    <div className="bg-background">
      {/* 1 — OUR STORY: the promise next to the room it is about. */}
      <section className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-2 lg:gap-16">
        <div className="overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={PHOTOS.room}
            alt="A sunlit living corner with a sofa, coffee table and plants"
            className="h-full w-full object-cover"
            style={{ aspectRatio: "4 / 3" }}
          />
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.21em] text-[var(--color-story-kicker)]">
            Our story
          </p>
          <h1
            className={`${storySerif.className} mt-4 text-[34px] leading-[1.16] text-[var(--color-story-heading)] sm:text-[42px]`}
          >
            More room for living.
          </h1>
          <p
            className={`${storySerif.className} mt-5 max-w-[46ch] text-[16px] leading-[1.75] text-[var(--color-story-body)]`}
          >
            At Luwag, we believe a comfortable home isn&apos;t about having more
            space. It&apos;s about making more of the space you have.
          </p>
        </div>
      </section>

      {/* 2 — WHY LUWAG: the idea, a photo, and the three things it buys you. */}
      <section className="bg-card">
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.05fr_1fr_0.95fr] lg:gap-12">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.21em] text-[var(--color-story-kicker)]">
              Why Luwag
            </p>
            <h2
              className={`${storySerif.className} mt-4 text-[28px] leading-[1.2] text-[var(--color-story-heading)] sm:text-[34px]`}
            >
              Less clutter. More living.
            </h2>
            <p
              className={`${storySerif.className} mt-5 max-w-[42ch] text-[15px] leading-[1.75] text-[var(--color-story-body)]`}
            >
              We started Luwag with a simple idea — thoughtful furniture can
              help real homes feel more open, organized, and comfortable, even
              in small spaces.
            </p>
          </div>
          <div className="overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={PHOTOS.desk}
              alt="A desk by a window with a rattan chair and plants"
              className="h-full w-full object-cover"
              style={{ aspectRatio: "4 / 3" }}
            />
          </div>
          <ul className="flex flex-col gap-6">
            {REASONS.map((reason) => (
              <li key={reason.title} className="flex gap-4">
                <span className="mt-0.5 shrink-0 text-[var(--color-story-kicker)]">
                  <LineIcon name={reason.icon} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-[var(--color-story-heading)]">
                    {reason.title}
                  </span>
                  <span
                    className={`${storySerif.className} mt-1 block text-[14px] leading-[1.6] text-[var(--color-story-body)]`}
                  >
                    {reason.body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3 — OUR PROMISE: how a piece is made, in three numbered steps. */}
      <section className="mx-auto grid max-w-[1200px] gap-12 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.21em] text-[var(--color-story-kicker)]">
            Our promise
          </p>
          <h2
            className={`${storySerif.className} mt-4 max-w-[18ch] text-[28px] leading-[1.2] text-[var(--color-story-heading)] sm:text-[34px]`}
          >
            Thoughtful quality, from start to your home.
          </h2>
          <p
            className={`${storySerif.className} mt-5 max-w-[46ch] text-[15px] leading-[1.75] text-[var(--color-story-body)]`}
          >
            We work with trusted manufacturers and suppliers to make sure every
            piece is cared for — durable materials, honest pricing, and backed
            by a warranty. Every product is checked before it ships.
          </p>
          <Link
            href="/collections/new-arrivals"
            className="mt-8 inline-flex items-center gap-2 rounded-md bg-[var(--color-story-panel)] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Our manufacturing
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ol className="grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <div className="overflow-hidden rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={step.image}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{ aspectRatio: "4 / 3" }}
                />
              </div>
              <p className="mt-4 text-[13px] font-medium tracking-[0.12em] text-[var(--color-story-kicker)]">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-2 text-sm font-semibold text-[var(--color-story-heading)]">
                {step.title}
              </h3>
              <p
                className={`${storySerif.className} mt-2 text-[14px] leading-[1.65] text-[var(--color-story-body)]`}
              >
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* 4 — GOOD LIVING: what every order comes with. */}
      <section className="bg-card">
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.21em] text-[var(--color-story-kicker)]">
              Shop our best in essentials
            </p>
            <h2
              className={`${storySerif.className} mt-4 max-w-[16ch] text-[28px] leading-[1.2] text-[var(--color-story-heading)] sm:text-[34px]`}
            >
              Good living should feel simple.
            </h2>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2">
              {ESSENTIALS.map((item) => (
                <li key={item.label} className="flex items-center gap-3">
                  <span className="shrink-0 text-[var(--color-story-kicker)]">
                    <LineIcon name={item.icon} />
                  </span>
                  <span className="text-sm text-[var(--color-story-heading)]">
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={PHOTOS.essentials}
              alt="A Luwag piece packed and ready to go"
              className="h-full w-full object-cover"
              style={{ aspectRatio: "4 / 3" }}
            />
          </div>
        </div>
      </section>

      {/* 5 — THE COLLECTION: the closing call to action. */}
      <section className="grid lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={PHOTOS.collection}
            alt="A calm bedroom corner with warm bedding"
            className="h-full w-full object-cover"
            style={{ aspectRatio: "4 / 3" }}
          />
        </div>
        <div className="flex flex-col justify-center bg-[var(--color-story-panel)] px-8 py-14 text-[#f7f5f0] sm:px-12 md:py-20">
          <p className="text-[11px] font-medium uppercase tracking-[0.21em] text-[#c3cdb8]">
            Make room for what matters
          </p>
          <h2
            className={`${storySerif.className} mt-4 text-[30px] leading-[1.18] sm:text-[38px]`}
          >
            Explore the collection.
          </h2>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            <Link
              href="/collections/new-arrivals"
              className="inline-flex items-center gap-2 rounded-md bg-[#f7f5f0] px-6 py-3 text-sm font-medium text-[var(--color-story-panel)] transition-opacity hover:opacity-90"
            >
              Shop now
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/collections/new-arrivals"
              className="border-b border-[#8fa383] pb-0.5 text-sm text-[#e6ebdf] transition-opacity hover:opacity-80"
            >
              View all products
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
