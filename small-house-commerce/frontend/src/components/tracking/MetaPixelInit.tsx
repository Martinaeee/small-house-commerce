"use client";

import { useEffect } from "react";
import { initMetaPixel } from "@/lib/tracking";

/** Loads the Meta Pixel once per session and fires the initial PageView. */
export function MetaPixelInit() {
  useEffect(() => {
    initMetaPixel();
  }, []);

  return null;
}
