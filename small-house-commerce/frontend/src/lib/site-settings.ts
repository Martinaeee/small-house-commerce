import { serverApiUrl } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";

/** Shopper-facing contact configuration; mirrors storefront/settings payload. */
export interface SiteSettings {
  messengerUrl: string;
  supportEmail: string;
  supportPhone: string;
  supportHours: string;
  newsletterBandEnabled: boolean;
  newsletterPopupEnabled: boolean;
  newsletterPopupDelaySeconds: number;
  newsletterOfferTitle: string;
  newsletterOfferBody: string;
  newsletterEyebrow: string;
  newsletterFormTitle: string;
  newsletterEmailPlaceholder: string;
  newsletterConsentText: string;
  /** Computed by the server; never infer offer availability from copy. */
  newsletterOfferAvailable: boolean;
  /** Site-wide default for the PDP selling-point pills. */
  hideSellingPoints: boolean;
  /** False in production until a real email provider is fully configured. */
  backInStockEnabled: boolean;
}

/** Fallback values when the backend/settings endpoint is unavailable. */
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  messengerUrl: "",
  supportEmail: "hello@luwag.shop",
  supportPhone: "",
  supportHours: "Mon–Sat, 9am–6pm (PHT)",
  newsletterBandEnabled: true,
  newsletterPopupEnabled: false,
  newsletterPopupDelaySeconds: 5,
  newsletterOfferTitle: "",
  newsletterOfferBody: "",
  newsletterEyebrow: "The LUWAG edit",
  newsletterFormTitle: "Subscribe by email",
  newsletterEmailPlaceholder: "Your email address",
  newsletterConsentText:
    "By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.",
  newsletterOfferAvailable: false,
  hideSellingPoints: false,
  backInStockEnabled: false,
};

export function normalizeSiteSettings(
  data: Partial<SiteSettings> | null,
): SiteSettings {
  return {
    messengerUrl: typeof data?.messengerUrl === "string" ? data.messengerUrl : DEFAULT_SITE_SETTINGS.messengerUrl,
    supportEmail: typeof data?.supportEmail === "string" ? data.supportEmail : DEFAULT_SITE_SETTINGS.supportEmail,
    supportPhone:
      typeof data?.supportPhone === "string"
        ? data.supportPhone
        : DEFAULT_SITE_SETTINGS.supportPhone,
    supportHours: typeof data?.supportHours === "string" ? data.supportHours : DEFAULT_SITE_SETTINGS.supportHours,
    newsletterBandEnabled:
      typeof data?.newsletterBandEnabled === "boolean"
        ? data.newsletterBandEnabled
        : DEFAULT_SITE_SETTINGS.newsletterBandEnabled,
    newsletterPopupEnabled:
      typeof data?.newsletterPopupEnabled === "boolean"
        ? data.newsletterPopupEnabled
        : DEFAULT_SITE_SETTINGS.newsletterPopupEnabled,
    newsletterPopupDelaySeconds:
      typeof data?.newsletterPopupDelaySeconds === "number"
        ? data.newsletterPopupDelaySeconds
        : DEFAULT_SITE_SETTINGS.newsletterPopupDelaySeconds,
    newsletterOfferTitle:
      typeof data?.newsletterOfferTitle === "string"
        ? data.newsletterOfferTitle
        : DEFAULT_SITE_SETTINGS.newsletterOfferTitle,
    newsletterOfferBody:
      typeof data?.newsletterOfferBody === "string"
        ? data.newsletterOfferBody
        : DEFAULT_SITE_SETTINGS.newsletterOfferBody,
    newsletterEyebrow:
      typeof data?.newsletterEyebrow === "string"
        ? data.newsletterEyebrow
        : DEFAULT_SITE_SETTINGS.newsletterEyebrow,
    newsletterFormTitle:
      typeof data?.newsletterFormTitle === "string"
        ? data.newsletterFormTitle
        : DEFAULT_SITE_SETTINGS.newsletterFormTitle,
    newsletterEmailPlaceholder:
      typeof data?.newsletterEmailPlaceholder === "string"
        ? data.newsletterEmailPlaceholder
        : DEFAULT_SITE_SETTINGS.newsletterEmailPlaceholder,
    newsletterConsentText:
      typeof data?.newsletterConsentText === "string"
        ? data.newsletterConsentText
        : DEFAULT_SITE_SETTINGS.newsletterConsentText,
    newsletterOfferAvailable:
      typeof data?.newsletterOfferAvailable === "boolean"
        ? data.newsletterOfferAvailable
        : DEFAULT_SITE_SETTINGS.newsletterOfferAvailable,
    hideSellingPoints:
      typeof data?.hideSellingPoints === "boolean"
        ? data.hideSellingPoints
        : DEFAULT_SITE_SETTINGS.hideSellingPoints,
    backInStockEnabled:
      typeof data?.backInStockEnabled === "boolean"
        ? data.backInStockEnabled
        : DEFAULT_SITE_SETTINGS.backInStockEnabled,
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
    return normalizeSiteSettings((await res.json()) as Partial<SiteSettings>);
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}
