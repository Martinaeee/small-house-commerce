"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import { CartProvider } from "@/components/cart/CartContext";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import type { SiteSettings } from "@/lib/site-settings";

/** Client providers that wrap the whole storefront shell. */
export function Providers({
  settings,
  children,
}: {
  settings: SiteSettings;
  children: ReactNode;
}) {
  return (
    <AuthProvider>
      <CartProvider>
        <SiteSettingsProvider settings={settings}>{children}</SiteSettingsProvider>
      </CartProvider>
    </AuthProvider>
  );
}
