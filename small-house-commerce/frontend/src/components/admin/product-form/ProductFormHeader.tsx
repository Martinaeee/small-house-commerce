"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
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
  tabError: string;
  saveDraft: string;
  savePublish: string;
  saveChanges: string;
  saveUnpublish: string;
  saving: string;
}

export interface ProductFormHeaderProps {
  currentStatus: ProductStatus;
  savedStatus: ProductStatus | null;
  pending: boolean;
  currentTab: ProductFormTabKey;
  tabErrors: Partial<Record<ProductFormTabKey, boolean>>;
  labels: ProductFormHeaderLabels;
  backHref?: string;
  onStatusChange: (status: ProductStatus) => void;
  onTabChange: (tab: ProductFormTabKey) => void;
  /** Emits the button's submit intent; the owning form still performs validation and submission. */
  onSubmitIntent?: () => void;
  /** Persistent problem rail rendered inside the sticky chrome. */
  errorRail?: ReactNode;
}

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
  currentTab,
  tabErrors,
  labels,
  backHref = "/admin/products",
  onStatusChange,
  onTabChange,
  onSubmitIntent,
  errorRail,
}: ProductFormHeaderProps): ReactNode {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const submitLabel = pending ? labels.saving : saveLabel(currentStatus, savedStatus, labels);

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
        <div className="flex items-center gap-2">
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
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="submit"
            onClick={onSubmitIntent}
            disabled={pending}
            aria-busy={pending}
            className="h-9 min-w-[9rem] rounded-lg bg-cta px-5 text-sm font-semibold text-white hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-ink-muted"
          >
            {submitLabel}
          </button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label={labels.tabsAria}
        className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-1"
      >
        {PRODUCT_FORM_TABS.map((tab, index) => {
          const selected = currentTab === tab.key;
          const hasError = tabErrors[tab.key] === true;
          return (
            <button
              key={tab.key}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`pf-tab-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              aria-controls={`pf-panel-${tab.key}`}
              onClick={() => onTabChange(tab.key)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                selected
                  ? "bg-cta text-white"
                  : "border border-border bg-card text-ink-secondary hover:text-cta"
              }`}
            >
              {labels.tabs[tab.key]}
              {hasError ? (
                <span
                  aria-label={labels.tabError}
                  className="ml-1.5 inline-block h-2 w-2 rounded-full bg-sale align-middle"
                />
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
