import { ProductCard } from "@/components/product/ProductCard";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

export function ProductGridSection({ section }: { section: HomepageSection }) {
  const products = section.products ?? [];
  const twoColumns = section.payload?.columns === 2;
  const gridClass = twoColumns
    ? "grid grid-cols-2 gap-4"
    : "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4";

  return (
    <SectionShell>
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      {products.length === 0 ? (
        <SectionPlaceholder
          inside
          message="Products coming soon — our team is curating this selection."
        />
      ) : (
        <div className={gridClass}>
          {products.map((product, index) => (
            <div
              key={product.id}
              className="contents"
              {...trackAttrs("ProductClick", section, index + 1)}
            >
              <ProductCard product={product} badge={product.badge ?? undefined} />
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}
