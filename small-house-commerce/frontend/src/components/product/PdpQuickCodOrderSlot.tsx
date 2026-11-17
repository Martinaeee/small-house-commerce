"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useDesktopViewport } from "./useDesktopViewport";

/**
 * Phone-free gate for the inline Cash on Delivery form.
 *
 * `PdpQuickCodOrder` imports the whole Philippine address dataset
 * (~185KB of JSON: provinces, cities, barangays and ZIP lookups). Importing
 * it statically put that chunk in every product page's initial JS even
 * though phones never render the form — they buy through the fixed bar and
 * the shared drawer. The loader only runs once a desktop viewport mounts
 * the component, so the data stays out of the mobile ad-landing path
 * entirely.
 */
const QuickOrderChunk = dynamic(
  () =>
    import("./PdpQuickCodOrder").then((module) => ({
      default: module.PdpQuickCodOrder,
    })),
  { ssr: false, loading: () => null },
);

export function PdpQuickCodOrderSlot(): ReactNode {
  const desktop = useDesktopViewport();
  if (!desktop) return null;
  return <QuickOrderChunk />;
}
