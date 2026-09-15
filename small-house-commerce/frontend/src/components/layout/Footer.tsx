import Link from "next/link";
import { BrandWordmark } from "./BrandWordmark";

/**
 * FRONTEND_SPEC §16 Footer. Static trust + contact content is fine here;
 * navigation links stay data-driven (collections), shown for convenience.
 */
export function Footer({ collections }: { collections: { id: string; slug: string; name: string }[] }) {
  return (
    <footer className="mt-16 border-t border-border bg-card">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-4 py-12 sm:px-6 md:grid-cols-3">
        <div>
          <BrandWordmark className="text-lg" />
          <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-muted">
            Small-space furniture, made roomy
          </p>
          <p className="mt-2 max-w-xs text-sm text-ink-secondary">
            Furniture for Filipino condos and rentals. Cash on delivery,
            nationwide.
          </p>
        </div>

        <nav aria-label="Footer collections">
          <p className="text-sm font-semibold text-ink">Shop</p>
          <ul className="mt-3 flex flex-col gap-2">
            {collections.map((collection) => (
              <li key={collection.id}>
                <Link
                  href={`/collections/${collection.slug}`}
                  className="text-sm text-ink-secondary hover:text-cta"
                >
                  {collection.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <p className="text-sm font-semibold text-ink">Contact</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-secondary">
            <li>Cash on Delivery nationwide</li>
            <li>Mon–Sat, 9am–6pm (PHT)</li>
            <li>support@luwag.ph</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border py-4">
        <p className="mx-auto max-w-[1200px] px-4 text-center text-xs text-ink-muted sm:px-6">
          © {new Date().getFullYear()} LUWAG Living. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
