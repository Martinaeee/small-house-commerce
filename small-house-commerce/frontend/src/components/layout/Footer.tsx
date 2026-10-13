import Link from "next/link";
import { SubscribeBand } from "@/components/newsletter/SubscribeBand";
import { BrandWordmark } from "./BrandWordmark";

/**
 * FRONTEND_SPEC §16 Footer. Static trust + contact content is fine here;
 * navigation links stay data-driven (collections), shown for convenience.
 *
 * One continuous warm-brown surface: the subscribe block is the footer's own
 * column (Castlery pattern) instead of a separate band stacked above a white
 * footer, so the two no longer read as disconnected blocks.
 */
export function Footer({
  collections,
  supportEmail,
  supportPhone,
  supportHours,
  newsletterEnabled,
}: {
  collections: { id: string; slug: string; name: string }[];
  supportEmail: string;
  supportPhone: string;
  supportHours: string;
  newsletterEnabled: boolean;
}) {
  const phone = supportPhone.trim();
  const phoneHref = phone.replace(/[()\-\s]/g, "");

  return (
    <footer className="mt-16 bg-[#704632] text-[#fff8f1]">
      <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 lg:py-14">
        <div
          className={`grid grid-cols-1 gap-10 sm:grid-cols-2 lg:gap-12 ${
            newsletterEnabled
              ? "lg:grid-cols-[1.05fr_0.9fr_1fr_1.35fr]"
              : "lg:grid-cols-[1.15fr_0.9fr_1fr]"
          }`}
        >
          <div>
            <BrandWordmark className="text-lg" tone="onDark" />
            <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.18em] text-[#d9c2b5]">
              Small-space furniture, made roomy
            </p>
            <p className="mt-3 max-w-xs text-sm leading-6 text-[#ead7ca]">
              Furniture for Filipino condos and rentals. Cash on delivery,
              nationwide.
            </p>
          </div>

          <nav aria-label="Footer collections">
            <p className="text-sm font-semibold text-white">Shop</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {collections.map((collection) => (
                <li key={collection.id}>
                  <Link
                    href={`/collections/${collection.slug}`}
                    className="text-sm text-[#ead7ca] transition hover:text-white"
                  >
                    {collection.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="text-sm font-semibold text-white">Contact</p>
            <ul className="mt-4 flex flex-col gap-2.5 text-sm text-[#ead7ca]">
              <li>
                <Link
                  href="/track-order"
                  className="transition hover:text-white"
                >
                  Track Order
                </Link>
              </li>
              <li>Cash on Delivery nationwide</li>
              <li>{supportHours}</li>
              {phone ? (
                <li>
                  <a
                    href={`tel:${phoneHref}`}
                    className="transition hover:text-white"
                  >
                    {phone}
                  </a>
                </li>
              ) : null}
              <li>
                <a
                  href={`mailto:${supportEmail}`}
                  className="transition hover:text-white"
                >
                  {supportEmail}
                </a>
              </li>
            </ul>
          </div>

          {newsletterEnabled ? <SubscribeBand /> : null}
        </div>
      </div>

      <div className="border-t border-[#9b7460]/40">
        <p className="mx-auto max-w-[1200px] px-4 py-5 text-xs text-[#d9c2b5] sm:px-6">
          © {new Date().getFullYear()} LUWAG Living. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
