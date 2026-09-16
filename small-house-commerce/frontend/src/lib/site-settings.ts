import { serverApiUrl } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";

/** Shopper-facing contact configuration; mirrors storefront/settings payload. */
export interface SiteSettings {
  messengerUrl: string;
  supportEmail: string;
  supportHours: string;
}

/** Fallback values when the backend/settings endpoint is unavailable. */
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  messengerUrl: "",
  supportEmail: "support@luwag.ph",
  supportHours: "Mon–Sat, 9am–6pm (PHT)",
};

function coerce(data: Partial<SiteSettings> | null): SiteSettings {
  return {
    messengerUrl: typeof data?.messengerUrl === "string" ? data.messengerUrl : DEFAULT_SITE_SETTINGS.messengerUrl,
    supportEmail: typeof data?.supportEmail === "string" ? data.supportEmail : DEFAULT_SITE_SETTINGS.supportEmail,
    supportHours: typeof data?.supportHours === "string" ? data.supportHours : DEFAULT_SITE_SETTINGS.supportHours,
  };
}

/**
 * Server-only fetch of the singleton site settings. Shares the single
 * `storefront` ISR tag (revalidated after admin saves). Never throws: a
 * settings outage must not blank the layout — callers get built-in defaults.
 */
export async function fetchSiteSettings(): Promise<SiteSettings> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/settings"), {
      next: { revalidate: 300, tags: STOREFRONT_TAGS },
    });
    if (!res.ok) return DEFAULT_SITE_SETTINGS;
    return coerce((await res.json()) as Partial<SiteSettings>);
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}
