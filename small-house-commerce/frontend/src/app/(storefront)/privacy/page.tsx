import type { Metadata } from "next";
import Link from "next/link";
import { CookieSettingsButton } from "@/components/consent/CookieSettingsButton";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How LUWAG collects, uses and protects personal information on luwag.shop, including cookies, analytics and advertising measurement — and how to change your cookie choices.",
  alternates: { canonical: "/privacy" },
};

const SECTIONS = [
  {
    title: "Who we are",
    body: "LUWAG is an online furniture store for Filipino homes, based in the Philippines and operating luwag.shop. For anything in this policy you can reach us at hello@luwag.shop.",
  },
  {
    title: "What we collect",
    body: "When you place an order we collect the name, mobile number, delivery address, order notes and preferred delivery date you give us, together with the items and amounts of that order. If you subscribe to our newsletter or ask to be notified when an item is back in stock, we keep the email address or mobile number you entered. We do not create customer accounts and we do not ask for payment details online: orders are paid in cash on delivery.",
  },
  {
    title: "Information collected automatically",
    body: "Like most shops, we record how the site is used: pages viewed, products viewed, items added to the cart, checkout started, purchases completed, search terms, the device type, the page that referred you and campaign tags in the link you arrived on. These events are tied to a random session id kept in your browser tab, not to your name. We use them to understand what is working on the site and to fix what is not.",
  },
  {
    title: "Cookies and local storage",
    body: "The site needs a small amount of browser storage to work: your cart, checkout progress, session id and your cookie choice. These are always on because the shop cannot function without them. Optional advertising cookies — Meta's _fbp and _fbc — are set only after you press “Accept all” in the cookie banner. You can change that choice at any time with the Cookie Settings button below or in the footer.",
  },
  {
    title: "Advertising measurement",
    body: "When you accept optional cookies, we measure our advertising with Meta (Facebook and Instagram). Two channels are used: the Meta Pixel in your browser and Meta's Conversions API from our server, both keyed by the same event id so an event is counted once. The events are things like viewing a product, adding to cart, starting checkout and completing a purchase, together with product identifiers, quantities, amounts and the order number. For purchases, the mobile number you gave at checkout is converted to a one-way SHA-256 hash before it is sent, and we also send the IP address, browser user agent and Meta's own browser cookies so Meta can match the event to an ad click. Meta does not receive your name or delivery address from us. If you choose “Essential only”, neither channel runs.",
  },
  {
    title: "How we use information",
    body: "To confirm and deliver orders, to answer your messages, to send the emails you asked for, to keep records required for accounting and after-sales service, to detect fraudulent or duplicate orders, and — subject to your cookie choice — to measure advertising. We do not sell personal information, and we do not use your order data for unrelated marketing.",
  },
  {
    title: "Who we share it with",
    body: "Couriers and delivery partners receive what they need to deliver your parcel. Our service providers process data on our instructions: Meta for advertising measurement (only with your consent), Resend for automated email, and our hosting and database providers in Singapore and the Philippines. We may also disclose information when the law requires it.",
  },
  {
    title: "Retention",
    body: "Order records are kept for as long as needed for warranty, after-sales service and legal obligations. Site analytics are kept for a limited period and are not linked to your identity. Your cookie choice stays in your browser until you change it or clear site data.",
  },
  {
    title: "Your rights",
    body: "Under the Philippine Data Privacy Act of 2012 (RA 10173) you may ask to see the personal information we hold about you, correct it, object to certain processing, or ask us to erase it where the law allows. Write to hello@luwag.shop with enough detail for us to find your records (for example your order number and the mobile number you ordered with). We answer within the period the law allows. If you are not satisfied, you may complain to the National Privacy Commission (privacy.gov.ph).",
  },
  {
    title: "Changes to this policy",
    body: "If we change how the site handles personal information, this page is updated and the effective date below changes. Material changes that affect your choices will be shown in the cookie banner before they take effect.",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="bg-background">
      <header className="mx-auto max-w-[1200px] px-4 pt-10 sm:px-6 lg:pt-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-cta">
          Legal
        </p>
        <h1 className="mt-3 text-[clamp(26px,5vw,44px)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
          Privacy Policy
        </h1>
        <p className="mt-3 max-w-[62ch] text-sm leading-6 text-ink-secondary">
          This policy explains what personal information luwag.shop collects,
          why, and the choices you have. It applies to the website and to
          orders placed through it. Effective 27 October 2026.
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

      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">
                Your cookie choices
              </h2>
              <p className="mt-1.5 max-w-[62ch] text-sm leading-6 text-ink-secondary">
                Reopen the banner to accept optional cookies or keep only the
                ones the site needs. The choice applies in this browser.
              </p>
            </div>
            <CookieSettingsButton className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-cta px-5 text-sm font-semibold text-cta transition hover:bg-cta hover:text-cta-foreground" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <p className="text-sm leading-6 text-ink-secondary">
          Questions about this policy? Email{" "}
          <a
            href="mailto:hello@luwag.shop"
            className="text-cta underline underline-offset-2"
          >
            hello@luwag.shop
          </a>{" "}
          or read{" "}
          <Link href="/why-luwag" className="text-cta underline underline-offset-2">
            why we build the way we do
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
