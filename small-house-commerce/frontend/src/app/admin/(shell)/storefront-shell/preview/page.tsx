import type { Metadata } from "next";
import { SavedStorefrontShellPreview } from "@/components/admin/storefront-shell/SavedStorefrontShellPreview";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function StorefrontShellPreviewPage() {
  return <SavedStorefrontShellPreview />;
}
