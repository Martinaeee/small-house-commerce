"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";

const SiteSettingsContext = createContext<SiteSettings>(DEFAULT_SITE_SETTINGS);

/** Supplies admin-edited contact settings to client components. */
export function SiteSettingsProvider({
  settings,
  children,
}: {
  settings: SiteSettings;
  children: ReactNode;
}) {
  return (
    <SiteSettingsContext.Provider value={settings}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings(): SiteSettings {
  return useContext(SiteSettingsContext);
}
