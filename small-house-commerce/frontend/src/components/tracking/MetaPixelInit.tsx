"use client";

import { useEffect } from "react";
import { hasAdsConsent, onConsentChange } from "@/lib/consent";
import { initMetaPixel } from "@/lib/tracking";

/**
 * Loads the Meta Pixel once and fires the initial PageView — but only after
 * the visitor accepted optional cookies. If they accept while still on this
 * page, the pixel starts immediately; no reload needed.
 */
export function MetaPixelInit() {
  useEffect(() => {
    if (hasAdsConsent()) initMetaPixel();
    return onConsentChange((choice) => {
      if (choice === "granted") initMetaPixel();
    });
  }, []);

  return null;
}
