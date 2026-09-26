"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import {
  buildCampaignLinks,
  type CampaignLinkContext,
  type CampaignLinkErrorCode,
  type CampaignLinkInput,
} from "@/lib/campaign-link-builder";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";

const ERROR_KEYS: Record<CampaignLinkErrorCode, TKey> = {
  PRODUCT_INVALID: "link_builder_error_PRODUCT_INVALID",
  VARIANT_INVALID: "link_builder_error_VARIANT_INVALID",
  LANDING_PAGE_INVALID: "link_builder_error_LANDING_PAGE_INVALID",
  AID_REQUIRED: "link_builder_error_AID_REQUIRED",
  AID_TOO_LONG: "link_builder_error_AID_TOO_LONG",
  CAMPAIGN_ID_TOO_LONG: "link_builder_error_CAMPAIGN_ID_TOO_LONG",
  ADSET_ID_TOO_LONG: "link_builder_error_ADSET_ID_TOO_LONG",
  AD_ID_TOO_LONG: "link_builder_error_AD_ID_TOO_LONG",
  UTM_SOURCE_TOO_LONG: "link_builder_error_UTM_SOURCE_TOO_LONG",
  UTM_MEDIUM_TOO_LONG: "link_builder_error_UTM_MEDIUM_TOO_LONG",
  UTM_CAMPAIGN_TOO_LONG: "link_builder_error_UTM_CAMPAIGN_TOO_LONG",
};

function initialInput(context: CampaignLinkContext): CampaignLinkInput {
  const product = context.products[0];
  return {
    productId: product?.id ?? "",
    variantId: product?.variants[0]?.id ?? "",
    landingPageId: "",
    aid: "",
    campaignId: "",
    adsetId: "",
    adId: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
  };
}

function LinkRow({
  label,
  value,
  copyLabel,
  copiedLabel,
  copied,
  testId,
  onCopy,
}: {
  label: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
  copied: boolean;
  testId?: string;
  onCopy(): void;
}): ReactNode {
  return (
    <div>
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className="mt-1 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
        <code
          data-testid={testId}
          className="min-w-0 flex-1 break-all rounded-lg bg-background px-3 py-2.5 text-xs leading-relaxed text-ink-secondary"
        >
          {value}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="h-10 min-w-0 shrink-0 px-4 text-sm"
          onClick={onCopy}
        >
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
    </div>
  );
}

export function CampaignLinkBuilder({
  context,
}: {
  context: CampaignLinkContext;
}): ReactNode {
  const { t } = useAdminI18n();
  const [input, setInput] = useState<CampaignLinkInput>(() =>
    initialInput(context),
  );
  const [attempted, setAttempted] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const selectedProduct = context.products.find(
    (product) => product.id === input.productId,
  );
  const result = useMemo(
    () => buildCampaignLinks(context, input),
    [context, input],
  );
  const errors = attempted && !result.ok ? result.errors : {};
  const errorFor = (field: keyof CampaignLinkInput): string | undefined => {
    const code = errors[field];
    return code ? t(ERROR_KEYS[code]) : undefined;
  };

  const update = (field: keyof CampaignLinkInput, value: string): void => {
    setInput((current) => ({ ...current, [field]: value }));
  };

  const selectProduct = (productId: string): void => {
    const product = context.products.find(
      (candidate) => candidate.id === productId,
    );
    setInput((current) => ({
      ...current,
      productId,
      variantId: product?.variants[0]?.id ?? "",
      landingPageId: "",
    }));
  };

  const copy = async (key: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      setCopiedKey(null);
    }
  };

  return (
    <div className="mt-6 space-y-8">
      <section aria-labelledby="link-builder-target-heading">
        <h2
          id="link-builder-target-heading"
          className="text-lg font-semibold text-ink"
        >
          {t("link_builder_target_section")}
        </h2>
        <div className="mt-4 grid gap-5 lg:grid-cols-3">
          <Field
            label={t("link_builder_product")}
            htmlFor="link-builder-product"
            error={errorFor("productId")}
          >
            <Select
              id="link-builder-product"
              value={input.productId}
              onChange={(event) => selectProduct(event.target.value)}
            >
              {context.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t("link_builder_variant")}
            htmlFor="link-builder-variant"
            error={errorFor("variantId")}
          >
            <Select
              id="link-builder-variant"
              value={input.variantId}
              onChange={(event) => update("variantId", event.target.value)}
            >
              <option value="">{t("link_builder_no_variant")}</option>
              {selectedProduct?.variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t("link_builder_landing_page")}
            htmlFor="link-builder-landing-page"
            error={errorFor("landingPageId")}
          >
            <Select
              id="link-builder-landing-page"
              value={input.landingPageId}
              onChange={(event) =>
                update("landingPageId", event.target.value)
              }
            >
              <option value="">{t("link_builder_no_landing_page")}</option>
              {selectedProduct?.landingPages.map((landingPage) => (
                <option key={landingPage.id} value={landingPage.id}>
                  {landingPage.title} · /lp/{landingPage.slug}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      <section
        aria-labelledby="link-builder-attribution-heading"
        className="border-t border-border pt-7"
      >
        <h2
          id="link-builder-attribution-heading"
          className="text-lg font-semibold text-ink"
        >
          {t("link_builder_attribution_section")}
        </h2>
        <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <Field
            label={t("link_builder_aid")}
            htmlFor="link-builder-aid"
            hint={t("link_builder_aid_hint")}
            error={errorFor("aid")}
          >
            <TextInput
              id="link-builder-aid"
              value={input.aid}
              maxLength={64}
              autoComplete="off"
              onChange={(event) => update("aid", event.target.value)}
            />
          </Field>
          <Field
            label={t("link_builder_utm_source")}
            htmlFor="link-builder-utm-source"
            error={errorFor("utmSource")}
          >
            <TextInput
              id="link-builder-utm-source"
              value={input.utmSource}
              maxLength={120}
              onChange={(event) => update("utmSource", event.target.value)}
            />
          </Field>
          <Field
            label={t("link_builder_campaign_id")}
            htmlFor="link-builder-campaign-id"
            error={errorFor("campaignId")}
          >
            <TextInput
              id="link-builder-campaign-id"
              value={input.campaignId}
              maxLength={64}
              onChange={(event) => update("campaignId", event.target.value)}
            />
          </Field>
          <Field
            label={t("link_builder_adset_id")}
            htmlFor="link-builder-adset-id"
            error={errorFor("adsetId")}
          >
            <TextInput
              id="link-builder-adset-id"
              value={input.adsetId}
              maxLength={64}
              onChange={(event) => update("adsetId", event.target.value)}
            />
          </Field>
          <Field
            label={t("link_builder_ad_id")}
            htmlFor="link-builder-ad-id"
            error={errorFor("adId")}
          >
            <TextInput
              id="link-builder-ad-id"
              value={input.adId}
              maxLength={64}
              onChange={(event) => update("adId", event.target.value)}
            />
          </Field>
          <Field
            label={t("link_builder_utm_medium")}
            htmlFor="link-builder-utm-medium"
            error={errorFor("utmMedium")}
          >
            <TextInput
              id="link-builder-utm-medium"
              value={input.utmMedium}
              maxLength={120}
              onChange={(event) => update("utmMedium", event.target.value)}
            />
          </Field>
          <Field
            label={t("link_builder_utm_campaign")}
            htmlFor="link-builder-utm-campaign"
            error={errorFor("utmCampaign")}
          >
            <TextInput
              id="link-builder-utm-campaign"
              value={input.utmCampaign}
              maxLength={120}
              onChange={(event) => update("utmCampaign", event.target.value)}
            />
          </Field>
        </div>
        <Button
          type="button"
          className="mt-6"
          onClick={() => setAttempted(true)}
        >
          {t("link_builder_generate")}
        </Button>
      </section>

      <section
        aria-labelledby="link-builder-generated-heading"
        className="border-t border-border pt-7"
      >
        <h2
          id="link-builder-generated-heading"
          className="text-lg font-semibold text-ink"
        >
          {t("link_builder_generated_title")}
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          {t("link_builder_generated_hint")}
        </p>

        {attempted && result.ok ? (
          <div className="mt-4 space-y-5 rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
            <LinkRow
              label={t("link_builder_product_link")}
              value={result.links.product}
              copyLabel={t("link_builder_copy_product")}
              copiedLabel={t("link_builder_copied")}
              copied={copiedKey === "product"}
              onCopy={() => void copy("product", result.links.product)}
            />
            {result.links.variant ? (
              <LinkRow
                label={t("link_builder_variant_link")}
                value={result.links.variant}
                copyLabel={t("link_builder_copy_variant")}
                copiedLabel={t("link_builder_copied")}
                copied={copiedKey === "variant"}
                onCopy={() => void copy("variant", result.links.variant!)}
              />
            ) : null}
            <LinkRow
              label={t("link_builder_campaign_link")}
              value={result.links.campaign}
              copyLabel={t("link_builder_copy_campaign")}
              copiedLabel={t("link_builder_copied")}
              copied={copiedKey === "campaign"}
              testId="generated-campaign-url"
              onCopy={() => void copy("campaign", result.links.campaign)}
            />
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-background px-3 py-3 text-sm text-ink-muted">
            {t("link_builder_waiting")}
          </p>
        )}
      </section>
    </div>
  );
}
