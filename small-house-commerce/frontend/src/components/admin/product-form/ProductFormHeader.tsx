"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Badge } from "@/components/admin/Badge";
import type { ProductStatus } from "@/lib/admin-api";

export const PRODUCT_FORM_TABS = [
  { key: "basic", labelKey: "product_form_tab_basic" },
  { key: "media", labelKey: "product_form_tab_media" },
  { key: "variants", labelKey: "product_form_tab_variants" },
  { key: "specs", labelKey: "product_form_tab_specs" },
  { key: "shipping", labelKey: "product_form_tab_shipping" },
  { key: "seo", labelKey: "product_form_tab_seo" },
  { key: "preview", labelKey: "product_form_tab_preview" },
] as const;

export type ProductFormTabKey = (typeof PRODUCT_FORM_TABS)[number]["key"];

export interface ProductFormHeaderLabels {
  back: string;
  status: string;
  statusOptions: Record<ProductStatus, string>;
  tabs: Record<ProductFormTabKey, string>;
  tabsAria: string;
  statusAria: string;
  tabBlockingCount: (count: number) => string;
  tabWarningCount: (count: number) => string;
  saveDraft: string;
  savePublish: string;
  saveChanges: string;
  saveUnpublish: string;
  saving: string;
  /** Amber chip shown while the form holds edits the server has not seen. */
  unsavedChanges: string;
  previewAction: string;
  newProduct: string;
}

export interface ProductFormHeaderProps {
  currentStatus: ProductStatus;
  savedStatus: ProductStatus | null;
  pending: boolean;
  /** Blocks saving while an editor task is still changing the draft. */
  saveDisabledReason?: string | null;
  currentTab: ProductFormTabKey;
  tabIndicators: Partial<
    Record<ProductFormTabKey, { blocking: number; warning: number }>
  >;
  labels: ProductFormHeaderLabels;
  backHref?: string;
  onStatusChange: (status: ProductStatus) => void;
  onTabChange: (tab: ProductFormTabKey) => void;
  /** Emits the button's submit intent; the owning form still performs validation and submission. */
  onSubmitIntent?: () => void;
  /** Persistent problem rail rendered inside the sticky chrome. */
  errorRail?: ReactNode;
  /**
   * Saved identity (server truth). Absent on /new, where nothing is saved yet.
   * The product number is display-only: it is minted once and never edited.
   */
  identity?: {
    name: string;
    productCode: string | null;
    coverImageUrl: string | null;
    lastSavedLabel: string | null;
  } | null;
  /** True while the form differs from the last saved value. */
  dirty?: boolean;
}

const STATUS_TONES: Record<ProductStatus, "green" | "amber" | "red"> = {
  ACTIVE: "green",
  DRAFT: "amber",
  DISABLED: "red",
};

type SaveLabels = Pick<
  ProductFormHeaderLabels,
  "saveDraft" | "savePublish" | "saveChanges" | "saveUnpublish"
>;

function saveLabel(
  status: ProductStatus,
  savedStatus: ProductStatus | null,
  labels: SaveLabels,
): string {
  if (status === "DRAFT") return labels.saveDraft;
  if (status === "DISABLED") return labels.saveUnpublish;
  return savedStatus === "ACTIVE" ? labels.saveChanges : labels.savePublish;
}

export function ProductFormHeader({
  currentStatus,
  savedStatus,
  pending,
  saveDisabledReason = null,
  currentTab,
  tabIndicators,
  labels,
  backHref = "/admin/products",
  onStatusChange,
  onTabChange,
  onSubmitIntent,
  errorRail,
  identity = null,
  dirty = false,
}: ProductFormHeaderProps): ReactNode {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const submitLabel = pending ? labels.saving : saveDisabledReason ?? saveLabel(currentStatus, savedStatus, labels);

  const focusTab = (index: number): void => {
    const tab = PRODUCT_FORM_TABS[index];
    if (!tab) return;
    onTabChange(tab.key);
    tabRefs.current[index]?.focus();
  };

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % PRODUCT_FORM_TABS.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + PRODUCT_FORM_TABS.length) % PRODUCT_FORM_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = PRODUCT_FORM_TABS.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      focusTab(nextIndex);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onTabChange(PRODUCT_FORM_TABS[index].key);
    }
  };

  return (
    <div className="sticky top-14 z-10 -mx-4 mb-6 border-b border-border bg-background/95 px-4 pb-3 pt-3 backdrop-blur md:-mx-8 md:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href={backHref}
          className="text-sm font-semibold text-cta hover:underline"
        >
          ← {labels.back}
        </Link>

        <div className="flex min-w-0 items-center gap-3">
          {identity?.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail of an already-uploaded asset.
            <img
              src={identity.coverImageUrl}
              alt=""
              className="hidden h-10 w-10 shrink-0 rounded-lg border border-border object-cover sm:block"
              referrerPolicy="no-referrer"
            />
          ) : null}
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1
                className="truncate text-base font-semibold text-ink"
                title={identity?.name ?? labels.newProduct}
              >
                {identity?.name ?? labels.newProduct}
              </h1>
              {identity ? (
                <Badge
                  value={labels.statusOptions[savedStatus ?? currentStatus]}
                  tone={STATUS_TONES[savedStatus ?? currentStatus]}
                />
              ) : null}
              {dirty ? (
                <span className="shrink-0 rounded-full bg-admin-warning-soft px-2 py-0.5 text-xs font-semibold text-admin-warning">
                  {labels.unsavedChanges}
                </span>
              ) : null}
            </div>
            {identity ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                <span className="font-mono">
                  {identity.productCode ?? "—"}
                </span>
                {identity.lastSavedLabel ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{identity.lastSavedLabel}</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label htmlFor="pf-status" className="text-xs font-semibold text-ink-secondary">
            {labels.status}
          </label>
          <select
            id="pf-status"
            aria-label={labels.statusAria}
            value={currentStatus}
            onChange={(event) => onStatusChange(event.target.value as ProductStatus)}
            disabled={pending}
            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-semibold text-ink focus:border-cta focus:outline-none disabled:text-ink-muted"
          >
            <option value="DRAFT">{labels.statusOptions.DRAFT}</option>
            <option value="ACTIVE">{labels.statusOptions.ACTIVE}</option>
            <option value="DISABLED">{labels.statusOptions.DISABLED}</option>
          </select>
          <button
            type="button"
            onClick={() => onTabChange("preview")}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-cta hover:border-primary"
          >
            {labels.previewAction}
          </button>
          <button
            type="submit"
            onClick={onSubmitIntent}
            disabled={pending || Boolean(saveDisabledReason)}
            aria-busy={pending || Boolean(saveDisabledReason)}
            className="h-9 min-w-[9rem] rounded-lg bg-cta px-5 text-sm font-semibold text-white hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-ink-muted"
          >
            {submitLabel}
          </button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label={labels.tabsAria}
        className="mt-3 flex min-w-0 gap-1 overflow-x-auto"
      >
        {PRODUCT_FORM_TABS.map((tab, index) => {
          const selected = currentTab === tab.key;
          const indicator = tabIndicators[tab.key] ?? {
            blocking: 0,
            warning: 0,
          };
          return (
            <button
              key={tab.key}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              aria-label={labels.tabs[tab.key]}
              id={`pf-tab-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              aria-controls={`pf-panel-${tab.key}`}
              onClick={() => onTabChange(tab.key)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                selected
                  ? "border-cta text-cta"
                  : "border-transparent text-ink-secondary hover:text-cta"
              }`}
            >
              {labels.tabs[tab.key]}
              {indicator.blocking > 0 ? (
                <span
                  aria-label={labels.tabBlockingCount(indicator.blocking)}
                  className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-admin-error px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                >
                  {indicator.blocking}
                </span>
              ) : null}
              {indicator.warning > 0 ? (
                <span
                  aria-label={labels.tabWarningCount(indicator.warning)}
                  className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-admin-warning px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                >
                  {indicator.warning}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* The problem rail rides inside the sticky chrome so an error stays
          visible no matter how far the form is scrolled. */}
      {errorRail}
    </div>
  );
}

export function getProductFormSaveLabel(
  status: ProductStatus,
  savedStatus: ProductStatus | null,
  labels: SaveLabels,
): string {
  return saveLabel(status, savedStatus, labels);
}
