import { ProductCard } from "@/components/product/ProductCard";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { SectionProps } from "./sectionRegistry";
import { trackAttrs } from "@/lib/home-tracking";
import { moduleLayoutPresentation } from "@/lib/homepage-responsive";

export function ProductGridSection({ section, previewDevice, interactionMode, appearance }: SectionProps) {
  const products = section.products ?? [];
  const layout = moduleLayoutPresentation("PRODUCT_GRID", section.payload?.layout, previewDevice, section.payload?.columns, appearance);

  return (
    <SectionShell style={section.style} previewDevice={previewDevice}>
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      {products.length === 0 ? (
        <SectionPlaceholder
          inside
          message="Products coming soon — our team is curating this selection."
        />
      ) : (
        <div data-homepage-product-rail className="hp-product-rail" style={layout?.style}>
          {products.map((product, index) => (
            <div key={product.id} className="hp-product-rail-cell">
              <ProductCard
                product={product}
                badge={product.badge ?? undefined}
                interactionMode={interactionMode}
                navigationTrackAttrs={interactionMode === "preview" ? undefined : trackAttrs("ProductClick", section, index + 1)}
              />
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}
