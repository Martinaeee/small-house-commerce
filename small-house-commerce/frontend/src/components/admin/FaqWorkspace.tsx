"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "@/components/admin/Dialog";
import { newId } from "@/lib/admin-id";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import { errorStatus } from "@/lib/admin-auth";
import {
  adminApi,
  ADMIN_FAQ_CATEGORIES,
  type AdminFaqCategory,
  type AdminFaqItem,
  type AdminFaqMode,
  type AdminFaqProductGroup,
  type AdminProduct,
} from "@/lib/admin-api";
import { faqApi } from "@/lib/faq-api";
import {
  FaqItemDialog,
  emptyFaqItemDraft,
  type FaqItemDraft,
} from "./faq/FaqItemDialog";
import { FaqProductPickerDialog } from "./faq/FaqProductPickerDialog";
import { FaqProductSection } from "./faq/FaqProductSection";
import { FaqSettingsDialog } from "./faq/FaqSettingsDialog";
import { FaqSharedSection } from "./faq/FaqSharedSection";
import {
  FAQ_CATEGORY_LABEL_KEYS,
  faqCategoryOf,
  moveFaqItemWithinCategory,
  moveItemToIndex,
  withPositions,
} from "./faq/faq-view";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

type View = "all" | "shared" | "product";
type StatusFilter = "all" | "enabled" | "disabled";
type UpdatedFilter = "any" | "7d" | "30d";

interface SharedDialogState {
  key: string;
  mode: "add" | "edit" | "duplicate";
  draft: FaqItemDraft;
  error: string | null;
  conflict: boolean;
}

interface ProductDialogState {
  key: string;
  group: AdminFaqProductGroup;
  existedInList: boolean;
  mode: "add" | "edit";
  draft: FaqItemDraft;
  error: string | null;
  conflict: boolean;
}

type PendingDelete =
  | { kind: "shared"; item: AdminFaqItem }
  | { kind: "product"; group: AdminFaqProductGroup; item: AdminFaqItem };

interface PendingSharedSave {
  items: AdminFaqItem[];
  expectedVersion: number;
  productCount: number;
  close: () => void;
  setDialogError: (message: string | null, conflict: boolean) => void;
}

/**
 * The recency cutoff for the Updated filter. Called from event handlers and
 * fetch callbacks, never during render, so the page stays render-pure.
 */
function cutoffForUpdated(filter: UpdatedFilter): string | null {
  return filter === "any"
    ? null
    : new Date(
        Date.now() - (filter === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000,
      ).toISOString();
}

function toProductItem(draft: FaqItemDraft, position: number): AdminFaqItem {
  return {
    id: draft.id,
    title: draft.title,
    answer: draft.answer,
    enabled: draft.enabled,
    defaultOpen: draft.defaultOpen,
    position,
  };
}

function toSharedItem(draft: FaqItemDraft, position: number): AdminFaqItem {
  return {
    ...toProductItem(draft, position),
    category: draft.category,
    audience: draft.audience,
  };
}

function toProductWriteItem(item: AdminFaqItem): AdminFaqItem {
  const productItem = { ...item };
  delete productItem.category;
  delete productItem.audience;
  return productItem;
}

function toDraft(item: AdminFaqItem): FaqItemDraft {
  return {
    id: item.id,
    title: item.title,
    answer: item.answer,
    enabled: item.enabled,
    defaultOpen: item.defaultOpen,
    category: faqCategoryOf(item),
    audience: item.audience ?? { scope: "ALL" },
    position: item.position,
  };
}

/**
 * FAQ management: one page that shows the structure first (shared categories,
 * then products) and opens a dialog only when a question is added or edited.
 * Shared and product questions keep their existing data sources and version
 * locks; saves always send the full question list for their scope, never the
 * filtered view. Filters live in the URL, matching the other admin lists.
 */
export function FaqWorkspace({
  canEditShared,
  canEditProducts,
}: {
  canEditShared: boolean;
  canEditProducts: boolean;
}): ReactNode {
  const { t } = useAdminI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // --- URL params: source of truth -----------------------------------------

  const rawView = searchParams.get("view");
  const view: View =
    rawView === "shared" || rawView === "product" ? rawView : "all";
  const search = searchParams.get("search")?.trim() ?? "";
  const rawCategory = searchParams.get("category");
  const categoryFilter: AdminFaqCategory | "all" =
    ADMIN_FAQ_CATEGORIES.includes(rawCategory as AdminFaqCategory)
      ? (rawCategory as AdminFaqCategory)
      : "all";
  const productFilter = searchParams.get("product") ?? "all";
  const rawStatus = searchParams.get("status");
  const statusFilter: StatusFilter =
    rawStatus === "enabled" || rawStatus === "disabled" ? rawStatus : "all";
  const rawUpdated = searchParams.get("updated");
  const updatedFilter: UpdatedFilter =
    rawUpdated === "7d" || rawUpdated === "30d" ? rawUpdated : "any";
  const page =
    Math.max(1, Number.parseInt(searchParams.get("page") ?? "", 10)) || 1;

  // The cutoff that the Updated filter currently means; kept in state because
  // it is computed outside render and also drives the shared-row filter.
  const [updatedSince, setUpdatedSince] = useState<string | null>(null);

  const [sharedItems, setSharedItems] = useState<AdminFaqItem[]>([]);
  const [sharedVersion, setSharedVersion] = useState(0);
  const [sharedUsage, setSharedUsage] = useState<{
    productCount: number;
  } | null>(null);
  const [sharedLoading, setSharedLoading] = useState(canEditShared);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [sharedSaving, setSharedSaving] = useState(false);

  const [groups, setGroups] = useState<AdminFaqProductGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [productsLoading, setProductsLoading] = useState(canEditProducts);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const productsRequestId = useRef(0);

  const [filterProducts, setFilterProducts] = useState<AdminProduct[]>([]);
  const fetchedLinkedProducts = useRef<Set<string>>(new Set());

  const [sharedDialog, setSharedDialog] = useState<SharedDialogState | null>(
    null,
  );
  const [productDialog, setProductDialog] = useState<ProductDialogState | null>(
    null,
  );
  const [settingsGroup, setSettingsGroup] =
    useState<AdminFaqProductGroup | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsConflict, setSettingsConflict] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const pickerRequestId = useRef(0);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [pendingSharedSave, setPendingSharedSave] =
    useState<PendingSharedSave | null>(null);

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (
        ["search", "product", "page", "updated"].some((key) => key in patch)
      ) {
        setProductsLoading(true);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Search box keeps instant local state; changes sync to the URL after a
  // debounce, and URL -> input reconciliation happens during render.
  const [searchInput, setSearchInput] = useState(search);
  const [syncedSearch, setSyncedSearch] = useState(search);
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setSearchInput(search);
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      const value = searchInput.trim();
      if (value !== search) patchParams({ search: value || null, page: null });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search, patchParams]);

  const loadShared = useCallback(() => {
    if (!canEditShared) return;
    faqApi
      .getShared()
      .then((data) => {
        setSharedItems(data.items);
        setSharedVersion(data.version);
        setSharedUsage(data.usage ?? null);
        setSharedError(null);
      })
      .catch((err: unknown) => {
        setSharedError(
          err instanceof Error ? err.message : t("faq_product_load_failed"),
        );
      })
      .finally(() => setSharedLoading(false));
  }, [canEditShared, t]);

  useEffect(() => {
    loadShared();
  }, [loadShared]);

  const loadProducts = useCallback(
    (query: {
      page: number;
      search: string;
      productId: string;
      updatedSince: string | null;
    }): Promise<void> => {
      if (!canEditProducts) return Promise.resolve();
      const requestId = ++productsRequestId.current;
      return faqApi
        .getProductGroups({
          ...(query.search.trim() ? { search: query.search.trim() } : {}),
          ...(query.productId !== "all" ? { productId: query.productId } : {}),
          ...(query.updatedSince ? { updatedSince: query.updatedSince } : {}),
          page: query.page,
          pageSize: PAGE_SIZE,
        })
        .then((result) => {
          if (requestId !== productsRequestId.current) return;
          setGroups(result.items);
          setTotal(result.total);
          setProductsError(null);
        })
        .catch((err: unknown) => {
          if (requestId !== productsRequestId.current) return;
          setProductsError(
            err instanceof Error ? err.message : t("faq_product_load_failed"),
          );
        })
        .finally(() => {
          if (requestId === productsRequestId.current)
            setProductsLoading(false);
        });
    },
    [canEditProducts, t],
  );

  useEffect(() => {
    const cutoff = cutoffForUpdated(updatedFilter);
    void loadProducts({
      page,
      search,
      productId: productFilter,
      updatedSince: cutoff,
    }).then(() => setUpdatedSince(cutoff));
  }, [loadProducts, page, search, productFilter, updatedFilter]);

  const reloadProducts = useCallback(() => {
    setProductsLoading(true);
    void loadProducts({
      page,
      search,
      productId: productFilter,
      updatedSince: cutoffForUpdated(updatedFilter),
    });
  }, [loadProducts, page, search, productFilter, updatedFilter]);

  // Product filter options; a deep-linked product outside the first page is
  // fetched once and merged in so the select can show it.
  useEffect(() => {
    if (!canEditProducts) return;
    let active = true;
    adminApi
      .listProducts({ page: 1, pageSize: 50 })
      .then((result) => {
        if (active) setFilterProducts(result.items);
      })
      .catch(() => {
        /* the filter still works for the deep-linked product alone */
      });
    return () => {
      active = false;
    };
  }, [canEditProducts]);

  useEffect(() => {
    if (!canEditProducts || productFilter === "all") return;
    if (fetchedLinkedProducts.current.has(productFilter)) return;
    fetchedLinkedProducts.current.add(productFilter);
    let active = true;
    adminApi
      .getProduct(productFilter)
      .then((product) => {
        if (!active) return;
        setFilterProducts((current) =>
          current.some((item) => item.id === product.id)
            ? current
            : [product, ...current],
        );
      })
      .catch(() => {
        /* the server-side filter still applies */
      });
    return () => {
      active = false;
    };
  }, [canEditProducts, productFilter]);

  const sharedWriteError = (
    err: unknown,
    setDialogError: (message: string | null, conflict: boolean) => void,
  ) => {
    const conflict = errorStatus(err) === 409;
    setDialogError(
      conflict
        ? t("faq_conflict_reload")
        : err instanceof Error
          ? err.message
          : t("faq_impact_failed"),
      conflict,
    );
  };

  const finishSharedSave = (
    nextItems: AdminFaqItem[],
    close: () => void,
    setDialogError: (message: string | null, conflict: boolean) => void,
  ): Promise<void> => {
    if (sharedSaving || pendingSharedSave) return Promise.resolve();
    const items = withPositions(nextItems);
    setSharedSaving(true);
    setDialogError(null, false);
    return faqApi
      .previewSharedImpact(items, sharedVersion)
      .then((impact) => {
        setPendingSharedSave({
          items,
          expectedVersion: impact.version,
          productCount: impact.productCount,
          close,
          setDialogError,
        });
      })
      .catch((err: unknown) => sharedWriteError(err, setDialogError))
      .finally(() => setSharedSaving(false));
  };

  const confirmSharedSave = (): Promise<void> => {
    if (!pendingSharedSave || sharedSaving) return Promise.resolve();
    const pending = pendingSharedSave;
    setSharedSaving(true);
    pending.setDialogError(null, false);
    return faqApi
      .updateShared(pending.items, pending.expectedVersion)
      .then(() => {
        setPendingSharedSave(null);
        pending.close();
        // Re-read so per-question timestamps come from the server, not the draft.
        loadShared();
      })
      .catch((err: unknown) => {
        setPendingSharedSave(null);
        sharedWriteError(err, pending.setDialogError);
      })
      .finally(() => setSharedSaving(false));
  };

  const openSharedDialog = (
    mode: SharedDialogState["mode"],
    draft: FaqItemDraft,
  ) => {
    setSharedDialog({
      key: `${mode}-${draft.id}`,
      mode,
      draft,
      error: null,
      conflict: false,
    });
  };

  const handleSharedDialogSave = (draft: FaqItemDraft) => {
    if (!sharedDialog) return;
    setSharedDialog((current) =>
      current ? { ...current, draft } : current,
    );
    const nextItems =
      sharedDialog.mode === "edit"
        ? sharedItems.map((item) =>
            item.id === draft.id ? toSharedItem(draft, item.position) : item,
          )
        : [...sharedItems, toSharedItem(draft, sharedItems.length)];
    void finishSharedSave(
      nextItems,
      () => setSharedDialog(null),
      (message, conflict) =>
        setSharedDialog((current) =>
          current ? { ...current, error: message, conflict } : current,
        ),
    );
  };

  const finishProductSave = (
    group: AdminFaqProductGroup,
    next: { mode: AdminFaqMode; items: AdminFaqItem[] },
    options: {
      existedInList: boolean;
      onSuccess?: () => void;
      onError?: (message: string, conflict: boolean) => void;
    },
  ): Promise<void> => {
    if (savingIds.has(group.product.id)) return Promise.resolve();
    const writeItems = next.items.map(toProductWriteItem);
    setSavingIds((current) => new Set(current).add(group.product.id));
    return adminApi
      .updateProduct(group.product.id, {
        faq: {
          mode: next.mode,
          items: writeItems,
          expectedVersion: group.faq.version,
        },
      })
      .then((product) => {
        const savedFaq = product.faq ?? {
          mode: next.mode,
          items: writeItems,
          version: group.faq.version + 1,
        };
        if (options.existedInList) {
          setGroups((current) =>
            current.map((currentGroup) =>
              currentGroup.product.id === group.product.id
                ? { ...currentGroup, faq: savedFaq }
                : currentGroup,
            ),
          );
        }
        options.onSuccess?.();
        reloadProducts();
      })
      .catch((err: unknown) => {
        const conflict = errorStatus(err) === 409;
        options.onError?.(
          conflict
            ? t("faq_conflict_reload")
            : err instanceof Error
              ? err.message
              : t("faq_save_failed"),
          conflict,
        );
      })
      .finally(() => {
        setSavingIds((current) => {
          const nextSet = new Set(current);
          nextSet.delete(group.product.id);
          return nextSet;
        });
      });
  };

  const selectProductForFaq = (product: AdminProduct) => {
    const requestId = ++pickerRequestId.current;
    setPickerLoading(true);
    setPickerError(null);
    adminApi
      .getProduct(product.id)
      .then((detail) => {
        if (requestId !== pickerRequestId.current) return;
        const faq = detail.faq ?? {
          mode: "SHARED" as const,
          items: [],
          version: 0,
        };
        const group: AdminFaqProductGroup = {
          product: {
            id: detail.id,
            name: detail.name,
            slug: detail.slug,
            status: detail.status,
            productCode: detail.productCode,
            thumbnailUrl: detail.images[0]?.url ?? null,
            thumbnailAlt: detail.images[0]?.altText ?? null,
          },
          faq,
        };
        const existedInList = groups.some(
          (current) => current.product.id === group.product.id,
        );
        setPickerOpen(false);
        setProductDialog({
          key: `add-${group.product.id}-${newId()}`,
          group,
          existedInList,
          mode: "add",
          draft: emptyFaqItemDraft(faq.items.length),
          error: null,
          conflict: false,
        });
      })
      .catch((err: unknown) => {
        if (requestId === pickerRequestId.current) {
          setPickerError(
            err instanceof Error ? err.message : t("faq_product_load_failed"),
          );
        }
      })
      .finally(() => {
        if (requestId === pickerRequestId.current) setPickerLoading(false);
      });
  };

  const handleProductDialogSave = (draft: FaqItemDraft) => {
    if (!productDialog) return;
    const { group, mode, existedInList } = productDialog;
    let items: AdminFaqItem[];
    if (mode === "edit") {
      const index = group.faq.items.findIndex((item) => item.id === draft.id);
      const replaced = group.faq.items.map((item) =>
        item.id === draft.id ? toProductItem(draft, draft.position) : item,
      );
      items = withPositions(moveItemToIndex(replaced, index, draft.position));
    } else {
      const appended = [
        ...group.faq.items,
        toProductItem(draft, group.faq.items.length),
      ];
      items = withPositions(
        moveItemToIndex(appended, appended.length - 1, draft.position),
      );
    }
    // Adding the first question to a SHARED product would hide it; EXTEND shows
    // the shared questions plus the new one. CUSTOM and EXTEND are untouched.
    const nextMode =
      mode === "add" && group.faq.mode === "SHARED" ? "EXTEND" : group.faq.mode;
    void finishProductSave(
      group,
      { mode: nextMode, items },
      {
        existedInList,
        onSuccess: () => setProductDialog(null),
        onError: (message, conflict) =>
          setProductDialog((current) =>
            current ? { ...current, error: message, conflict } : current,
          ),
      },
    );
  };

  const handleSettingsSave = (mode: AdminFaqMode) => {
    if (!settingsGroup) return;
    void finishProductSave(
      settingsGroup,
      { mode, items: settingsGroup.faq.items },
      {
        existedInList: groups.some(
          (current) => current.product.id === settingsGroup.product.id,
        ),
        onSuccess: () => {
          setSettingsGroup(null);
          setSettingsError(null);
          setSettingsConflict(false);
        },
        onError: (message, conflict) => {
          setSettingsError(message);
          setSettingsConflict(conflict);
        },
      },
    );
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    setDeleteSaving(true);
    setDeleteError(null);
    const done =
      pendingDelete.kind === "shared"
        ? finishSharedSave(
            sharedItems.filter((item) => item.id !== pendingDelete.item.id),
            () => setPendingDelete(null),
            (message) => setDeleteError(message),
          )
        : finishProductSave(
            pendingDelete.group,
            {
              mode: pendingDelete.group.faq.mode,
              items: withPositions(
                pendingDelete.group.faq.items.filter(
                  (current) => current.id !== pendingDelete.item.id,
                ),
              ),
            },
            {
              existedInList: true,
              onSuccess: () => setPendingDelete(null),
              onError: (message) => setDeleteError(message),
            },
          );
    void done.finally(() => setDeleteSaving(false));
  };

  const availableViews: View[] = [
    "all",
    ...(canEditShared ? (["shared"] as const) : []),
    ...(canEditProducts ? (["product"] as const) : []),
  ];
  const showShared = canEditShared && (view === "all" || view === "shared");
  const showProduct = canEditProducts && (view === "all" || view === "product");

  if (!canEditShared && !canEditProducts) {
    return (
      <div className="mx-auto w-full max-w-[1280px] px-4 py-12 md:px-8">
        <div
          role="alert"
          className="rounded-xl border border-border bg-card p-8 text-center"
        >
          <p className="text-base font-semibold text-ink">
            {t("faq_permission_denied")}
          </p>
        </div>
      </div>
    );
  }

  const viewLabels: Record<View, string> = {
    all: t("faq_view_all"),
    shared: t("faq_view_shared"),
    product: t("faq_view_product"),
  };

  return (
    <div
      data-faq-workspace
      className="mx-auto w-full max-w-[1280px] space-y-5 px-4 py-6 md:px-8"
    >
      <PageHeader
        title={t("faq_workspace_title")}
        subtitle={t("faq_workspace_description")}
        actions={
          <div
            role="toolbar"
            aria-label={t("faq_actions")}
            className="flex flex-wrap gap-2"
          >
            {canEditShared ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() =>
                  openSharedDialog("add", emptyFaqItemDraft(sharedItems.length))
                }
              >
                + {t("faq_shared_add")}
              </Button>
            ) : null}
            {canEditProducts ? (
              <Button
                size="md"
                onClick={() => {
                  setPickerError(null);
                  setPickerOpen(true);
                }}
              >
                + {t("faq_product_add")}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="space-y-3">
        <div
          role="tablist"
          aria-label={t("faq_filter_type")}
          className="inline-flex flex-wrap rounded-lg bg-background p-1"
        >
          {availableViews.map((available) => (
            <button
              key={available}
              role="tab"
              type="button"
              aria-selected={view === available}
              onClick={() =>
                patchParams({ view: available === "all" ? null : available })
              }
              className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                view === available
                  ? "border border-border bg-card text-ink shadow-sm"
                  : "border border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {viewLabels[available]}
            </button>
          ))}
        </div>

        <div
          role="toolbar"
          aria-label={t("faq_filter_toolbar")}
          className="flex flex-wrap items-center gap-2 border-y border-border py-3 xl:flex-nowrap"
        >
          <label className="min-w-[220px] flex-[1_1_280px]">
            <span className="sr-only">{t("faq_filter_search")}</span>
            <input
              id="faq-filter-search"
              type="search"
              value={searchInput}
              placeholder={t("faq_filter_search_placeholder")}
              onChange={(event) => setSearchInput(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-cta"
            />
          </label>
          <label className="w-[132px] shrink-0">
            <span className="sr-only">{t("faq_filter_type")}</span>
            <select
              id="faq-filter-type"
              aria-label={t("faq_filter_type")}
              value={view}
              onChange={(event) =>
                patchParams({
                  view:
                    event.target.value === "all" ? null : event.target.value,
                })
              }
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-[13px] text-ink outline-none focus:border-cta"
            >
              {availableViews.map((available) => (
                <option key={available} value={available}>
                  {viewLabels[available]}
                </option>
              ))}
            </select>
          </label>
          <label className="w-[150px] shrink-0">
            <span className="sr-only">{t("faq_filter_category")}</span>
            <select
              id="faq-filter-category"
              aria-label={t("faq_filter_category")}
              value={categoryFilter}
              disabled={!showShared}
              onChange={(event) =>
                patchParams({
                  category:
                    event.target.value === "all" ? null : event.target.value,
                })
              }
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-[13px] text-ink outline-none focus:border-cta disabled:opacity-60"
            >
              <option value="all">{t("faq_filter_category_all")}</option>
              {ADMIN_FAQ_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(FAQ_CATEGORY_LABEL_KEYS[category])}
                </option>
              ))}
            </select>
          </label>
          <label className="w-[178px] shrink-0">
            <span className="sr-only">{t("faq_filter_product")}</span>
            <select
              id="faq-filter-product"
              aria-label={t("faq_filter_product")}
              value={productFilter}
              disabled={!showProduct}
              onChange={(event) =>
                patchParams({
                  product:
                    event.target.value === "all" ? null : event.target.value,
                  page: null,
                })
              }
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-[13px] text-ink outline-none focus:border-cta disabled:opacity-60"
            >
              <option value="all">{t("faq_filter_product_all")}</option>
              {filterProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.productCode ? `${product.productCode} · ` : ""}
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className="w-[120px] shrink-0">
            <span className="sr-only">{t("faq_filter_status")}</span>
            <select
              id="faq-filter-status"
              aria-label={t("faq_filter_status")}
              value={statusFilter}
              onChange={(event) =>
                patchParams({
                  status:
                    event.target.value === "all" ? null : event.target.value,
                })
              }
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-[13px] text-ink outline-none focus:border-cta"
            >
              <option value="all">{t("faq_filter_status_all")}</option>
              <option value="enabled">{t("faq_status_enabled")}</option>
              <option value="disabled">{t("faq_status_disabled")}</option>
            </select>
          </label>
          <label className="w-[134px] shrink-0">
            <span className="sr-only">{t("faq_filter_updated")}</span>
            <select
              id="faq-filter-updated"
              aria-label={t("faq_filter_updated")}
              value={updatedFilter}
              onChange={(event) =>
                patchParams({
                  updated:
                    event.target.value === "any" ? null : event.target.value,
                  page: null,
                })
              }
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-[13px] text-ink outline-none focus:border-cta"
            >
              <option value="any">{t("faq_filter_updated_any")}</option>
              <option value="7d">{t("faq_filter_updated_7d")}</option>
              <option value="30d">{t("faq_filter_updated_30d")}</option>
            </select>
          </label>
          <Button
            variant="text"
            size="md"
            className="h-10 min-w-0 shrink-0 px-2 text-[13px] font-semibold"
            onClick={() => {
              setSearchInput("");
              patchParams({
                view: null,
                search: null,
                category: null,
                product: null,
                status: null,
                updated: null,
                page: null,
              });
            }}
          >
            {t("faq_filter_reset")}
          </Button>
        </div>
      </div>

      {showShared ? (
        <FaqSharedSection
          items={sharedItems}
          usage={sharedUsage}
          loading={sharedLoading}
          error={sharedError}
          saving={sharedSaving}
          filters={{ search, status: statusFilter, updatedSince, productId: productFilter === "all" ? null : productFilter }}
          categoryFilter={categoryFilter}
          canEdit={canEditShared}
          onEdit={(item) => openSharedDialog("edit", toDraft(item))}
          onDuplicate={(item) =>
            openSharedDialog("duplicate", {
              ...toDraft(item),
              id: newId(),
              title: item.title.slice(0, 200 - t("product_faq_duplicate_suffix").length) + t("product_faq_duplicate_suffix"),
            })
          }
          onMove={(item, direction) =>
            void finishSharedSave(
              moveFaqItemWithinCategory(sharedItems, item.id, direction),
              () => undefined,
              (message) => setSharedError(message),
            )
          }
          onToggle={(item) =>
            void finishSharedSave(
              sharedItems.map((current) =>
                current.id === item.id
                  ? { ...current, enabled: !current.enabled }
                  : current,
              ),
              () => undefined,
              (message) => setSharedError(message),
            )
          }
          onDelete={(item) => {
            setDeleteError(null);
            setPendingDelete({ kind: "shared", item });
          }}
          onReload={() => {
            setSharedLoading(true);
            setSharedError(null);
            loadShared();
          }}
        />
      ) : null}

      {showProduct ? (
        <FaqProductSection
          groups={groups}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          loading={productsLoading}
          error={productsError}
          filters={{ search, status: statusFilter, updatedSince }}
          savingIds={savingIds}
          canEdit={canEditProducts}
          onAdd={(group) =>
            setProductDialog({
              key: `add-${group.product.id}-${newId()}`,
              group,
              existedInList: true,
              mode: "add",
              draft: emptyFaqItemDraft(group.faq.items.length),
              error: null,
              conflict: false,
            })
          }
          onEditItem={(group, item) =>
            setProductDialog({
              key: `edit-${group.product.id}-${item.id}`,
              group,
              existedInList: true,
              mode: "edit",
              draft: toDraft(item),
              error: null,
              conflict: false,
            })
          }
          onDuplicateItem={(group, item) =>
            setProductDialog({
              key: `duplicate-${group.product.id}-${newId()}`,
              group,
              existedInList: true,
              mode: "add",
              draft: {
                ...toDraft(item),
                id: newId(),
                title: item.title.slice(0, 200 - t("product_faq_duplicate_suffix").length) + t("product_faq_duplicate_suffix"),
                position: group.faq.items.length,
              },
              error: null,
              conflict: false,
            })
          }
          onToggleItem={(group, item) =>
            void finishProductSave(
              group,
              {
                mode: group.faq.mode,
                items: group.faq.items.map((current) =>
                  current.id === item.id
                    ? { ...current, enabled: !current.enabled }
                    : current,
                ),
              },
              {
                existedInList: true,
                onError: (message) => setProductsError(message),
              },
            )
          }
          onDeleteItem={(group, item) => {
            setDeleteError(null);
            setPendingDelete({ kind: "product", group, item });
          }}
          onSettings={(group) => {
            setSettingsError(null);
            setSettingsConflict(false);
            setSettingsGroup(group);
          }}
          onPage={(nextPage) => patchParams({ page: String(nextPage) })}
          onReload={reloadProducts}
        />
      ) : null}

      {sharedDialog && !pendingSharedSave ? (
        <FaqItemDialog
          key={sharedDialog.key}
          title={
            sharedDialog.mode === "edit"
              ? t("faq_dialog_edit_shared")
              : sharedDialog.mode === "duplicate"
                ? t("faq_dialog_duplicate_shared")
                : t("faq_dialog_new_shared")
          }
          item={sharedDialog.draft}
          showCategory
          showSort={false}
          showAudience
          saving={sharedSaving}
          error={sharedDialog.error}
          onReloadError={
            sharedDialog.conflict
              ? () => {
                  setSharedDialog(null);
                  setSharedLoading(true);
                  setSharedError(null);
                  loadShared();
                }
              : null
          }
          onCancel={() => setSharedDialog(null)}
          onSave={handleSharedDialogSave}
        />
      ) : null}

      {productDialog ? (
        <FaqItemDialog
          key={productDialog.key}
          title={
            productDialog.mode === "edit"
              ? t("faq_dialog_edit_product")
              : t("faq_dialog_new_product")
          }
          item={productDialog.draft}
          showCategory={false}
          showSort
          contextLabel={`${t("faq_filter_product")}: ${
            productDialog.group.product.productCode ?? t("faq_picker_no_code")
          } · ${productDialog.group.product.name}`}
          saving={savingIds.has(productDialog.group.product.id)}
          error={productDialog.error}
          onReloadError={
            productDialog.conflict
              ? () => {
                  setProductDialog(null);
                  reloadProducts();
                }
              : null
          }
          onCancel={() => setProductDialog(null)}
          onSave={handleProductDialogSave}
        />
      ) : null}

      {settingsGroup ? (
        <FaqSettingsDialog
          productName={settingsGroup.product.name}
          mode={settingsGroup.faq.mode}
          saving={savingIds.has(settingsGroup.product.id)}
          error={settingsError}
          onReloadError={
            settingsConflict
              ? () => {
                  setSettingsGroup(null);
                  reloadProducts();
                }
              : null
          }
          onCancel={() => setSettingsGroup(null)}
          onSave={handleSettingsSave}
        />
      ) : null}

      {pickerOpen ? (
        <FaqProductPickerDialog
          onSelect={selectProductForFaq}
          onClose={() => {
            pickerRequestId.current += 1;
            setPickerLoading(false);
            setPickerOpen(false);
          }}
          selecting={pickerLoading}
          error={pickerError}
        />
      ) : null}

      {pendingSharedSave ? (
        <Dialog
          open
          title={t("faq_impact_title")}
          onClose={() => {
            if (!sharedSaving) setPendingSharedSave(null);
          }}
        >
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">
              {t("faq_impact_body", {
                count: pendingSharedSave.productCount,
              })}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setPendingSharedSave(null)}
                disabled={sharedSaving}
              >
                {t("faq_dialog_cancel")}
              </Button>
              <Button
                size="md"
                onClick={() => void confirmSharedSave()}
                disabled={sharedSaving}
              >
                {sharedSaving ? t("faq_shared_saving") : t("faq_shared_save")}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {pendingDelete && !pendingSharedSave ? (
        <Dialog
          open
          title={t("faq_dialog_delete_title")}
          onClose={() => setPendingDelete(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">
              {t("faq_dialog_delete_body")}
            </p>
            <p className="rounded-lg bg-background px-3 py-2 text-sm font-medium text-ink">
              {pendingDelete.item.title}
            </p>
            {deleteError ? (
              <div
                role="alert"
                className="rounded-lg border border-sale/30 bg-sale/5 p-3 text-sm text-red-700"
              >
                {deleteError}
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setPendingDelete(null)}
                disabled={deleteSaving}
              >
                {t("faq_dialog_cancel")}
              </Button>
              <Button size="md" onClick={confirmDelete} disabled={deleteSaving}>
                {t("faq_dialog_delete_confirm")}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
