import { SITE_URL } from "./product-jsonld";

export interface CampaignLinkContext {
  products: {
    id: string;
    name: string;
    slug: string;
    variants: { id: string; name: string }[];
    landingPages: { id: string; slug: string; title: string }[];
  }[];
}

export interface CampaignLinkInput {
  productId: string;
  variantId: string;
  landingPageId: string;
  aid: string;
  campaignId: string;
  adsetId: string;
  adId: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
}

export type CampaignLinkErrorCode =
  | "PRODUCT_INVALID"
  | "VARIANT_INVALID"
  | "LANDING_PAGE_INVALID"
  | "AID_REQUIRED"
  | "AID_TOO_LONG"
  | "CAMPAIGN_ID_TOO_LONG"
  | "ADSET_ID_TOO_LONG"
  | "AD_ID_TOO_LONG"
  | "UTM_SOURCE_TOO_LONG"
  | "UTM_MEDIUM_TOO_LONG"
  | "UTM_CAMPAIGN_TOO_LONG";

export type CampaignLinkBuildResult =
  | {
      ok: true;
      links: {
        product: string;
        variant: string | null;
        campaign: string;
      };
    }
  | {
      ok: false;
      errors: Partial<Record<keyof CampaignLinkInput, CampaignLinkErrorCode>>;
    };

const ATTRIBUTION_FIELDS: readonly {
  input: keyof Pick<
    CampaignLinkInput,
    | "aid"
    | "campaignId"
    | "adsetId"
    | "adId"
    | "utmSource"
    | "utmMedium"
    | "utmCampaign"
  >;
  query: string;
}[] = [
  { input: "aid", query: "aid" },
  { input: "campaignId", query: "campaign_id" },
  { input: "adsetId", query: "adset_id" },
  { input: "adId", query: "ad_id" },
  { input: "utmSource", query: "utm_source" },
  { input: "utmMedium", query: "utm_medium" },
  { input: "utmCampaign", query: "utm_campaign" },
];

const LENGTH_RULES: readonly {
  input: keyof CampaignLinkInput;
  max: number;
  error: CampaignLinkErrorCode;
}[] = [
  { input: "aid", max: 64, error: "AID_TOO_LONG" },
  { input: "campaignId", max: 64, error: "CAMPAIGN_ID_TOO_LONG" },
  { input: "adsetId", max: 64, error: "ADSET_ID_TOO_LONG" },
  { input: "adId", max: 64, error: "AD_ID_TOO_LONG" },
  { input: "utmSource", max: 120, error: "UTM_SOURCE_TOO_LONG" },
  { input: "utmMedium", max: 120, error: "UTM_MEDIUM_TOO_LONG" },
  { input: "utmCampaign", max: 120, error: "UTM_CAMPAIGN_TOO_LONG" },
];

function storefrontUrl(path: string): URL {
  return new URL(path, SITE_URL);
}

export function buildCampaignLinks(
  context: CampaignLinkContext,
  input: CampaignLinkInput,
): CampaignLinkBuildResult {
  const values = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, value.trim()]),
  ) as CampaignLinkInput;
  const errors: Partial<
    Record<keyof CampaignLinkInput, CampaignLinkErrorCode>
  > = {};

  const product = context.products.find(
    (candidate) => candidate.id === values.productId,
  );
  if (!product) errors.productId = "PRODUCT_INVALID";

  const variant = values.variantId
    ? product?.variants.find((candidate) => candidate.id === values.variantId)
    : undefined;
  if (values.variantId && product && !variant) {
    errors.variantId = "VARIANT_INVALID";
  }

  const landingPage = values.landingPageId
    ? product?.landingPages.find(
        (candidate) => candidate.id === values.landingPageId,
      )
    : undefined;
  if (values.landingPageId && product && !landingPage) {
    errors.landingPageId = "LANDING_PAGE_INVALID";
  }

  if (!values.aid) errors.aid = "AID_REQUIRED";
  for (const rule of LENGTH_RULES) {
    if (values[rule.input].length > rule.max) {
      errors[rule.input] = rule.error;
    }
  }

  if (Object.keys(errors).length > 0 || !product) {
    return { ok: false, errors };
  }

  const productUrl = storefrontUrl(
    `/products/${encodeURIComponent(product.slug)}`,
  );
  const variantUrl = variant ? new URL(productUrl) : null;
  if (variantUrl && variant) {
    variantUrl.searchParams.set("variant", variant.id);
  }

  const campaignUrl = landingPage
    ? storefrontUrl(`/lp/${encodeURIComponent(landingPage.slug)}`)
    : new URL(productUrl);
  if (variant) campaignUrl.searchParams.set("variant", variant.id);
  for (const field of ATTRIBUTION_FIELDS) {
    const value = values[field.input];
    if (value) campaignUrl.searchParams.set(field.query, value);
  }

  return {
    ok: true,
    links: {
      product: productUrl.toString(),
      variant: variantUrl?.toString() ?? null,
      campaign: campaignUrl.toString(),
    },
  };
}
