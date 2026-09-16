// src/components/product/PdpInfoSections.tsx
// Server-rendered PDP info card: shipping/returns/assembly policy + FAQ.
// Native <details>/<summary> gives dependency-free accordions with keyboard
// and screen-reader support; the chevron rotates via group-open.

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DetailsItem({
  title,
  children,
  open = false,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="group border-b border-border px-5 last:border-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <Chevron />
      </summary>
      <div className="pb-5 text-sm leading-relaxed text-ink-secondary">{children}</div>
    </details>
  );
}

export function PdpInfoSections({
  supportEmail,
  supportHours,
}: {
  supportEmail: string;
  supportHours: string;
}) {
  const mailto = `mailto:${supportEmail}`;
  return (
    <section
      id="shipping-faq"
      aria-labelledby="shipping-faq-title"
      className="scroll-mt-28 overflow-hidden rounded-lg border border-border bg-card"
    >
      <h2 id="shipping-faq-title" className="border-b border-border px-5 py-4 text-2xl font-semibold text-ink">
        Delivery, Returns &amp; FAQs
      </h2>

      <DetailsItem title="Delivery & Cash on Delivery" open>
        <ul className="flex list-disc flex-col gap-2 pl-4">
          <li>Metro Manila: 3–5 days. Free Metro Manila delivery on orders ₱3,000+.</li>
          <li>Provinces: 5–7 days through our nationwide delivery partners.</li>
          <li>Cash on Delivery is available nationwide — pay only when your order arrives.</li>
          <li>
            Questions about your delivery? Email{" "}
            <a href={mailto} className="font-medium text-cta underline-offset-2 hover:underline">
              {supportEmail}
            </a>{" "}
            ({supportHours}).
          </li>
        </ul>
      </DetailsItem>

      <DetailsItem title="Returns & Damage Claims">
        <p>
          Returns are accepted only for items that arrive damaged or defective. Please contact
          us at{" "}
          <a href={mailto} className="font-medium text-cta underline-offset-2 hover:underline">
            {supportEmail}
          </a>{" "}
          <strong>within 48 hours of delivery</strong> with photos of the item and its packaging,
          and we will arrange a replacement or refund. Items cannot be returned for non-quality
          issues such as change of mind or incorrect size after delivery.
        </p>
      </DetailsItem>

      <DetailsItem title="Assembly">
        <p>
          Assembly depends on the product. Foldable and ready-to-use items need no setup; other
          items ship with clear instructions and the hardware needed for assembly. Check the
          product details above, or contact us before ordering if you are unsure what this item
          requires.
        </p>
      </DetailsItem>

      <DetailsItem title="How does Cash on Delivery work?">
        <p>
          Place your order with your name, address and phone number — no payment online. When the
          rider delivers, inspect the item and pay the rider in cash. Please prepare the exact
          amount when possible.
        </p>
      </DetailsItem>

      <DetailsItem title="Can I change or cancel my order?">
        <p>
          Contact us as soon as possible at {supportEmail}. Address or item changes are possible
          while the order is still being processed; once an order has shipped, it can no longer be
          changed or redirected.
        </p>
      </DetailsItem>

      <DetailsItem title="Will it fit my space?">
        <p>
          Check the Size guide in the product details above for exact dimensions, and measure your
          doorway, hallway and intended spot before ordering — especially for sofas, tables and
          beds. Delivery crews cannot disassemble doorframes, so a few minutes of measuring is the
          best way to avoid a tight fit.
        </p>
      </DetailsItem>

      <DetailsItem title="Do I need to drill or mount anything?">
        <p>
          Most LUWAG Living pieces are freestanding or foldable and need no drilling at all, which
          makes them rental-friendly. If a specific item requires wall fixing, it is noted in the
          product details.
        </p>
      </DetailsItem>
    </section>
  );
}
