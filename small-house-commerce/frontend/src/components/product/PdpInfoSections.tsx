import type { ProductFaqItem } from "@/lib/api";
import { ProductFaqSection } from "./ProductFaqSection";

export function PdpInfoSections({
  items,
  supportEmail,
  supportHours,
}: {
  items: ProductFaqItem[];
  supportEmail: string;
  supportHours: string;
}) {
  return (
    <ProductFaqSection
      items={items}
      supportEmail={supportEmail}
      supportHours={supportHours}
    />
  );
}
