"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatAmount, type AdminSearchHit, type AdminSearchResponse } from "@/lib/admin-api";
import {
  ADMIN_SEARCH_GROUPS,
  adminSearchHitHref,
  adminSearchOptionId,
  type AdminSearchGroupKey,
} from "@/lib/admin-search";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";

const GROUP_LABEL_KEYS: Record<AdminSearchGroupKey, TKey> = {
  products: "admin_search_group_products",
  orders: "admin_search_group_orders",
  customers: "admin_search_group_customers",
  shipments: "admin_search_group_shipments",
};

const MATCH_LABEL_KEYS: Record<AdminSearchHit["matchedField"], TKey> = {
  PRODUCT_CODE: "admin_search_match_product_code",
  SKU_CODE: "admin_search_match_sku_code",
  NAME: "admin_search_match_name",
  SLUG: "admin_search_match_slug",
  ORDER_NUMBER: "admin_search_match_order_number",
  PHONE: "admin_search_match_phone",
  CUSTOMER_NAME: "admin_search_match_customer_name",
  EMAIL: "admin_search_match_email",
  TRACKING_NUMBER: "admin_search_match_tracking_number",
};

const PRODUCT_STATUS_KEYS = {
  DRAFT: "product_form_status_draft",
  ACTIVE: "product_form_status_active",
  DISABLED: "product_form_status_disabled",
} as const satisfies Record<string, TKey>;

const SKU_STATUS_KEYS = {
  ACTIVE: "product_sku_status_ACTIVE",
  DISABLED: "product_sku_status_DISABLED",
} as const satisfies Record<string, TKey>;

const ORDER_STATUS_KEYS: Record<string, TKey> = {
  NEW: "admin_search_order_status_NEW",
  PENDING: "admin_search_order_status_PENDING",
  QUESTION: "admin_search_order_status_QUESTION",
  CONFIRMED: "admin_search_order_status_CONFIRMED",
  ABNORMAL: "admin_search_order_status_ABNORMAL",
  SHIPPING: "admin_search_order_status_SHIPPING",
  SIGNED: "admin_search_order_status_SIGNED",
  CANCELLED: "admin_search_order_status_CANCELLED",
  DENIED: "admin_search_order_status_DENIED",
  AFTER_SALES: "admin_search_order_status_AFTER_SALES",
};

const CONFIRMATION_STATUS_KEYS: Record<string, TKey> = {
  UNCONFIRMED: "admin_search_confirmation_UNCONFIRMED",
  NEEDS_REVIEW: "admin_search_confirmation_NEEDS_REVIEW",
  CONFIRMED: "admin_search_confirmation_CONFIRMED",
  REJECTED: "admin_search_confirmation_REJECTED",
};

const SHIPMENT_STATUS_KEYS: Record<string, TKey> = {
  SHIPPING: "admin_search_shipment_status_SHIPPING",
  SIGNED: "admin_search_shipment_status_SIGNED",
};

function groupItems(
  response: AdminSearchResponse,
  group: AdminSearchGroupKey,
): AdminSearchHit[] {
  switch (group) {
    case "products":
      return response.groups.products?.items ?? [];
    case "orders":
      return response.groups.orders?.items ?? [];
    case "customers":
      return response.groups.customers?.items ?? [];
    case "shipments":
      return response.groups.shipments?.items ?? [];
  }
}

function statusLabel(
  value: string,
  keys: Record<string, TKey>,
  t: ReturnType<typeof useAdminI18n>["t"],
): string {
  const key = keys[value];
  return key ? t(key) : value;
}

function ResultContent({ hit }: { hit: AdminSearchHit }): ReactNode {
  const { t } = useAdminI18n();
  const match = (
    <span className="rounded-full bg-admin-primary-soft px-2 py-0.5 text-[10px] font-semibold text-admin-primary">
      {t(MATCH_LABEL_KEYS[hit.matchedField])}: {hit.matchedText}
    </span>
  );

  switch (hit.kind) {
    case "PRODUCT":
      return (
        <>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold text-ink">{hit.name}</span>
            <span className="shrink-0 text-xs text-ink-muted">
              {hit.productCode ?? t(PRODUCT_STATUS_KEYS[hit.status])}
            </span>
            {hit.productCode ? (
              <span className="shrink-0 text-xs text-ink-muted">
                {t(PRODUCT_STATUS_KEYS[hit.status])}
              </span>
            ) : null}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
            {match}
            {hit.matchedSku ? (
              <>
                <span>{hit.matchedSku.variantName}</span>
                <span>{hit.matchedSku.skuCode}</span>
                <span>{t(SKU_STATUS_KEYS[hit.matchedSku.skuStatus])}</span>
                <span>{formatAmount(hit.matchedSku.price)}</span>
                <span>
                  {t("admin_search_available", {
                    count: hit.matchedSku.availableInventory,
                  })}
                </span>
              </>
            ) : (
              <span>{t(PRODUCT_STATUS_KEYS[hit.status])}</span>
            )}
          </span>
        </>
      );
    case "ORDER":
      return (
        <>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold text-ink">{hit.orderNumber}</span>
            <span className="shrink-0 text-xs text-ink-muted">
              {statusLabel(hit.orderStatus, ORDER_STATUS_KEYS, t)}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
            {match}
            <span>{hit.customerName ?? hit.normalizedPhone}</span>
            <span>
              {statusLabel(
                hit.confirmationStatus,
                CONFIRMATION_STATUS_KEYS,
                t,
              )}
            </span>
          </span>
        </>
      );
    case "CUSTOMER":
      return (
        <>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold text-ink">
              {hit.name ?? hit.normalizedPhone}
            </span>
            <span className="shrink-0 text-xs text-ink-muted">
              {t("admin_search_risk", { level: hit.riskLevel })}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
            {match}
            <span>{hit.normalizedPhone}</span>
            {hit.email ? <span>{hit.email}</span> : null}
          </span>
        </>
      );
    case "SHIPMENT":
      return (
        <>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold text-ink">
              {hit.trackingNumber}
            </span>
            <span className="shrink-0 text-xs text-ink-muted">
              {statusLabel(hit.status, SHIPMENT_STATUS_KEYS, t)}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
            {match}
            <span>{hit.carrier}</span>
            <span>{t("admin_search_order_ref", { number: hit.orderNumber })}</span>
          </span>
        </>
      );
  }
}

export interface AdminSearchResultsProps {
  id?: string;
  response: AdminSearchResponse;
  mode: "dialog" | "page";
  activeOptionId?: string | null;
  onActivate?: (hit: AdminSearchHit) => void;
  onActiveOptionChange?: (optionId: string) => void;
}

export function AdminSearchResults({
  id,
  response,
  mode,
  activeOptionId = null,
  onActivate,
  onActiveOptionChange,
}: AdminSearchResultsProps): ReactNode {
  const { t } = useAdminI18n();
  const content = ADMIN_SEARCH_GROUPS.map((group) => {
    const allItems = groupItems(response, group);
    const items = mode === "dialog" ? allItems.slice(0, 5) : allItems;
    if (items.length === 0) return null;
    const headingId = `${id ?? "admin-search-results"}-${group}`;

    return (
      <section
        key={group}
        role={mode === "dialog" ? "group" : undefined}
        aria-labelledby={headingId}
        className="border-b border-border last:border-b-0"
      >
        <h3
          id={headingId}
          className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
        >
          {t(GROUP_LABEL_KEYS[group])}
        </h3>
        <div className="px-2 pb-2">
          {items.map((hit) => {
            const optionId = adminSearchOptionId(hit);
            const className = `block w-full rounded-lg px-3 py-2 text-left transition-colors ${
              activeOptionId === optionId
                ? "bg-admin-primary-soft"
                : "hover:bg-admin-surface-secondary"
            }`;
            if (mode === "page") {
              return (
                <Link
                  key={optionId}
                  href={adminSearchHitHref(hit)}
                  className={className}
                >
                  <ResultContent hit={hit} />
                </Link>
              );
            }
            return (
              <button
                key={optionId}
                id={optionId}
                type="button"
                role="option"
                aria-selected={activeOptionId === optionId}
                className={className}
                onFocus={() => onActiveOptionChange?.(optionId)}
                onMouseMove={() => onActiveOptionChange?.(optionId)}
                onClick={() => onActivate?.(hit)}
              >
                <ResultContent hit={hit} />
              </button>
            );
          })}
        </div>
      </section>
    );
  });

  if (mode === "dialog") {
    return (
      <div id={id} role="listbox" className="max-h-[min(60vh,560px)] overflow-y-auto">
        {content}
      </div>
    );
  }

  return <div id={id}>{content}</div>;
}
