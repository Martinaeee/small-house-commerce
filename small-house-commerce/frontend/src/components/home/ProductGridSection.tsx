import { ProductCard } from "@/components/product/ProductCard";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { SectionProps } from "./sectionRegistry";
import { trackAttrs } from "@/lib/home-tracking";

export function ProductGridSection({ section, previewDevice }: SectionProps) {
  const products = section.products ?? [];
  const twoColumns = section.payload?.columns === 2;
  const gridClass = twoColumns
    ? "grid grid-cols-2 gap-4"
    : previewDevice === "desktop"
      ? "grid grid-cols-4 gap-4"
      : previewDevice === "tablet"
        ? "grid grid-cols-3 gap-4"
        : previewDevice === "mobile"
          ? "grid grid-cols-2 gap-4"
          : "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4";

  return (
    <SectionShell style={section.style}>
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
