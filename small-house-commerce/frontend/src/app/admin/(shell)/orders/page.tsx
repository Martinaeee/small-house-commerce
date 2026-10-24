"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field } from "@/components/admin/Field";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { Button } from "@/components/ui/Button";
import { VerificationDrawer, AssignTasksDialog } from "@/components/admin/orders/VerificationPanel";
import {
  CustomerHistoryDialog,
  OrderHistoryDialog,
} from "@/components/admin/orders/HistoryPanels";
import {
  adminApi,
  type AdminOrderListRow,
  type AdminOrderQueue,
  type AdminVerificationState,
  type Paged,
} from "@/lib/admin-api";
import {
  DEFAULT_HIDDEN_COLUMNS,
  visibleColumns,
  type WorkbenchColumnKey,
} from "@/components/admin/orders/workbench/columns";
import {
  newViewId,
  readColumnPrefs,
  readViews,
  writeColumnPrefs,
  writeViews,
  type SavedView,
} from "@/components/admin/orders/workbench/prefs";
import { OrderTable } from "@/components/admin/orders/workbench/OrderTable";
import {
  WorkbenchFilterBar,
  type WorkbenchFilterState,
} from "@/components/admin/orders/workbench/WorkbenchFilterBar";
import { OrderDrawer } from "@/components/admin/orders/workbench/OrderDrawer";
import {
  OrderRowDialogs,
  type RowDialogKind,
} from "@/components/admin/orders/workbench/OrderRowDialogs";
import {
  FulfillmentDialog,
  type FulfillmentKind,
} from "@/components/admin/orders/workbench/FulfillmentDialog";

/**
 * The order workbench (LUWAG Orders V2).
 *
 * One wide table with the fields the operator reads in order, the queue
 * tabs on top, the filters in one compact bar, and every action on the row
 * it belongs to. The details live in a drawer, the history in its own
 * window, and nothing is faked: every number comes from the server.
 */

const QUEUES: { key: AdminOrderQueue; labelKey: TKey }[] = [
  { key: "all", labelKey: "orders_tab_all" },
  { key: "todo", labelKey: "orders_tab_todo" },
  { key: "recheck", labelKey: "orders_tab_recheck" },
  { key: "tohandover", labelKey: "orders_tab_tohandover" },
  { key: "toship", labelKey: "orders_tab_toship" },
  { key: "shipping", labelKey: "orders_tab_shipping" },
  { key: "exception", labelKey: "orders_tab_exception" },
  { key: "signed", labelKey: "orders_tab_signed" },
  { key: "cods", labelKey: "orders_tab_cods" },
  { key: "cancelled", labelKey: "orders_tab_cancelled" },
  { key: "mine", labelKey: "orders_tab_mine" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Payment statuses the dashboard links with (paymentStatus=FAILED). The URL
// value stays a comma-separated set, like the status filter.
const PAYMENT_STATUS_VALUES = [
  "COD_PENDING",
  "COLLECTED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "ONLINE_PENDING",
  "PAID",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
];

// The notification links open the list with confirmation=NEEDS_REVIEW.
const CONFIRMATION_VALUES = ["UNCONFIRMED", "NEEDS_REVIEW", "CONFIRMED", "REJECTED"];

type QueueCounts = Record<string, number> | undefined;

/** Keeps a URL parameter inside a known set; anything else is ignored. */
function oneOf<const T extends readonly string[]>(
  value: string | null,
  allowed: T,
): T[number] | "" {
  if (!value) return "";
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : "";
}

function OrdersPageContent() {
  const { hasPermission } = useAdminAuth();
  const { t } = useAdminI18n();
  const canConfirmPerm = hasPermission("ORDER_CONFIRM");
  const canCancelPerm = hasPermission("ORDER_CANCEL");
  const canAssignPerm = hasPermission("ORDER_ASSIGN");
  const canNotePerm = hasPermission("ORDER_NOTE_WRITE");
  const canRiskPerm = hasPermission("ORDER_RISK_WRITE");
  const canMergePerm = hasPermission("ORDER_MERGE");
  const canHandoverPerm = hasPermission("ORDER_HANDOVER");
  const canShipPerm = hasPermission("SHIPMENT_CREATE");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // --- URL params: the source of truth -------------------------------------

  const search = searchParams.get("search")?.trim() ?? "";
  const rawStatus = searchParams.get("status") ?? "";
  const status = rawStatus
    .split(",")
    .filter((s): s is AdminOrderListRow["orderStatus"] =>
      [
        "NEW",
        "PENDING",
        "QUESTION",
        "CONFIRMED",
        "ABNORMAL",
        "SHIPPING",
        "SIGNED",
        "CANCELLED",
        "DENIED",
        "AFTER_SALES",
        "RETURNED",
        "PARTIALLY_RETURNED",
      ].includes(s as AdminOrderListRow["orderStatus"]),
    );
  const statusKey = status.join(",");
  const queue = oneOf(searchParams.get("queue"), [
    "all",
    "todo",
    "recheck",
    "tohandover",
    "toship",
    "shipping",
    "exception",
    "signed",
    "cods",
    "cancelled",
    "mine",
  ]) as AdminOrderQueue | "";
  const payment = oneOf(searchParams.get("payment"), ["COD", "AIRWALLEX"]);
  const paymentStatus = (searchParams.get("paymentStatus") ?? "")
    .split(",")
    .filter((value) => PAYMENT_STATUS_VALUES.includes(value))
    .join(",");
  const confirmation = oneOf(searchParams.get("confirmation"), CONFIRMATION_VALUES);
  const region = searchParams.get("region") ?? "";
  const classification = searchParams.get("classification") ?? "";
  const assignedTo = searchParams.get("assignedTo") ?? "";
  const risk = searchParams.get("risk") ?? "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const phone = searchParams.get("phone") ?? "";
  const sku = searchParams.get("sku") ?? "";
  const priority = oneOf(searchParams.get("priority"), ["NORMAL", "HIGH", "URGENT"]);
  const verification = oneOf(searchParams.get("verification"), [
    "none",
    "pending",
    "problem",
    "done",
    "open",
  ]);
  const followUp = oneOf(searchParams.get("followUp"), ["overdue", "today", "week"]);
  const sort = oneOf(searchParams.get("sort"), ["waiting", "newest", "verify"]);
  const page =
    Math.max(1, Number.parseInt(searchParams.get("page") ?? "", 10)) || 1;

  const filters: WorkbenchFilterState = {
    search,
    status: statusKey,
    payment,
    paymentStatus,
    confirmation,
    region,
    phone,
    sku,
    owner: assignedTo,
    priority,
    classification,
    risk,
    verification,
    followUp,
    dateFrom,
    dateTo,
    sort,
  };

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // The search box keeps its own state and syncs to the URL after 300ms.
  const [searchInput, setSearchInput] = useState(search);
  const [syncedSearch, setSyncedSearch] = useState(search);
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setSearchInput(search);
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      const value = searchInput.trim();
      if (value !== search) patchParams({ search: value || null, page: null });
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput, search, patchParams]);

  // --- assignee options for the staff filter --------------------------------
  const [assignees, setAssignees] = useState<{ id: string; name: string | null }[]>([]);
  useEffect(() => {
    let active = true;
    adminApi
      .listAssignees()
      .then((users) => {
        if (active) setAssignees(users);
      })
      .catch(() => {
        // Non-fatal: the staff lists stay empty.
      });
    return () => {
      active = false;
    };
  }, []);

  const staffName = useCallback(
    (id: string | null | undefined) =>
      id ? (assignees.find((person) => person.id === id)?.name ?? null) : null,
    [assignees],
  );

  // --- list data ------------------------------------------------------------

  const [data, setData] = useState<Paged<AdminOrderListRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const queryKey = [
    statusKey,
    queue,
    payment,
    paymentStatus,
    confirmation,
    region,
    classification,
    assignedTo,
    risk,
    search,
    dateFrom,
    dateTo,
    phone,
    sku,
    priority,
    verification,
    followUp,
    sort,
    String(page),
    String(nonce),
  ].join("|");
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const loading = fetchedKey !== queryKey;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    adminApi
      .listOrders({
        status: statusKey || undefined,
        queue: queue || undefined,
        payment: payment || undefined,
        paymentStatus: paymentStatus || undefined,
        confirmation: confirmation || undefined,
        region: region || undefined,
        classification: classification || undefined,
        assignedTo: assignedTo || undefined,
        risk: risk || undefined,
        search: search || undefined,
        dateFrom: DATE_RE.test(dateFrom) ? dateFrom : undefined,
        dateTo: DATE_RE.test(dateTo) ? dateTo : undefined,
        phone: phone || undefined,
        sku: sku || undefined,
        priority: priority || undefined,
        verification: verification || undefined,
        followUp: followUp || undefined,
        sort: sort || undefined,
        page,
      })
      .then((res) => {
        if (!active) return;
        setData(res);
        setError(null);
        setFetchedKey(queryKey);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load orders.");
        setFetchedKey(queryKey);
      });
    return () => {
      active = false;
    };
  }, [
    queryKey,
    statusKey,
    queue,
    payment,
    paymentStatus,
    confirmation,
    region,
    classification,
    assignedTo,
    risk,
    search,
    dateFrom,
    dateTo,
    phone,
    sku,
    priority,
    verification,
    followUp,
    sort,
    page,
  ]);

  // --- the counters of the queue tabs ---------------------------------------
  const [counts, setCounts] = useState<{
    total: number;
    queues: Record<string, number>;
  } | null>(null);

  const countsKey = [
    statusKey,
    payment,
    paymentStatus,
    confirmation,
    region,
    classification,
    assignedTo,
    risk,
    search,
    dateFrom,
    dateTo,
    phone,
    sku,
    priority,
    verification,
    followUp,
    String(nonce),
  ].join("|");

  useEffect(() => {
    let active = true;
    adminApi
      .orderCounts({
        status: statusKey || undefined,
        payment: payment || undefined,
        paymentStatus: paymentStatus || undefined,
        confirmation: confirmation || undefined,
        region: region || undefined,
        classification: classification || undefined,
        assignedTo: assignedTo || undefined,
        risk: risk || undefined,
        search: search || undefined,
        dateFrom: DATE_RE.test(dateFrom) ? dateFrom : undefined,
        dateTo: DATE_RE.test(dateTo) ? dateTo : undefined,
        phone: phone || undefined,
        sku: sku || undefined,
        priority: priority || undefined,
        verification: verification || undefined,
        followUp: followUp || undefined,
      })
      .then((result) => {
        if (!active) return;
        setCounts({ total: result.total, queues: result.queues ?? {} });
      })
      .catch(() => {
        if (active) setCounts(null);
      });
    return () => {
      active = false;
    };
  }, [
    countsKey,
    statusKey,
    payment,
    paymentStatus,
    confirmation,
    region,
    classification,
    assignedTo,
    risk,
    search,
    dateFrom,
    dateTo,
    phone,
    sku,
    priority,
    verification,
    followUp,
  ]);

  const queueCounts: QueueCounts = counts?.queues;

  // --- the layout of the table (columns, widths, views) ---------------------

  const [hiddenColumns, setHiddenColumns] = useState<WorkbenchColumnKey[]>(
    () => readColumnPrefs().hidden,
  );
  const [colWidths, setColWidths] = useState<Record<string, number>>(
    () => readColumnPrefs().widths,
  );
  const [views, setViews] = useState<SavedView[]>(() => readViews());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const persistColumns = useCallback(
    (hidden: WorkbenchColumnKey[], widths: Record<string, number>) => {
      writeColumnPrefs({ hidden, widths });
    },
    [],
  );

  const toggleColumn = useCallback(
    (key: WorkbenchColumnKey) => {
      setHiddenColumns((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
        persistColumns(next, colWidths);
        return next;
      });
    },
    [colWidths, persistColumns],
  );

  const resetColumns = useCallback(() => {
    setHiddenColumns([...DEFAULT_HIDDEN_COLUMNS]);
    setColWidths({});
    persistColumns([...DEFAULT_HIDDEN_COLUMNS], {});
  }, [persistColumns]);

  const changeWidth = useCallback(
    (key: WorkbenchColumnKey, width: number) => {
      setColWidths((prev) => {
        const next = { ...prev, [key]: width };
        persistColumns(hiddenColumns, next);
        return next;
      });
    },
    [hiddenColumns, persistColumns],
  );

  const resetWidth = useCallback(
    (key: WorkbenchColumnKey) => {
      setColWidths((prev) => {
        const next = { ...prev };
        delete next[key];
        persistColumns(hiddenColumns, next);
        return next;
      });
    },
    [hiddenColumns, persistColumns],
  );

  const columns = useMemo(() => visibleColumns(hiddenColumns), [hiddenColumns]);

  const toggleExpand = useCallback((orderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  // --- saved views ----------------------------------------------------------

  const saveView = useCallback(
    (name: string) => {
      const current = new URLSearchParams(searchParams.toString());
      current.delete("page");
      const filters: Record<string, string> = {};
      current.forEach((value, key) => {
        filters[key] = value;
      });
      const view: SavedView = {
        id: newViewId(),
        name,
        filters,
        hidden: hiddenColumns,
        widths: colWidths,
      };
      const next = [...views.filter((entry) => entry.name !== name), view];
      setViews(next);
      writeViews(next);
    },
    [searchParams, hiddenColumns, colWidths, views],
  );

  const applyView = useCallback(
    (view: SavedView) => {
      setHiddenColumns(view.hidden);
      setColWidths(view.widths);
      persistColumns(view.hidden, view.widths);
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries(view.filters)) next.set(key, value);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, persistColumns],
  );

  const deleteView = useCallback(
    (id: string) => {
      const next = views.filter((view) => view.id !== id);
      setViews(next);
      writeViews(next);
    },
    [views],
  );

  // --- the panels ------------------------------------------------------------

  const [drawerRow, setDrawerRow] = useState<AdminOrderListRow | null>(null);
  const [verifyRow, setVerifyRow] = useState<AdminOrderListRow | null>(null);
  const [assignRow, setAssignRow] = useState<AdminOrderListRow | null>(null);
  const [assignState, setAssignState] = useState<AdminVerificationState | null>(null);
  const [customerPhone, setCustomerPhone] = useState<string | null>(null);
  const [customerOrderNumber, setCustomerOrderNumber] = useState<string | null>(null);
  const [historyRow, setHistoryRow] = useState<AdminOrderListRow | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    row: AdminOrderListRow;
    x: number;
    y: number;
  } | null>(null);
  const [rowDialog, setRowDialog] = useState<RowDialogKind>(null);
  const [fulfillment, setFulfillment] = useState<{
    kind: FulfillmentKind;
    row: AdminOrderListRow;
  } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [dialogRow, setDialogRow] = useState<AdminOrderListRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [rowMenu]);

  /** The customer order history of one phone number. */
  const openCustomerHistory = useCallback(
    (phone: string, orderNumber?: string | null) => {
      setCustomerPhone(phone);
      setCustomerOrderNumber(orderNumber ?? null);
    },
    [],
  );

  /**
   * Open another order of the same customer: from the history window or from
   * the customer list. The order may be outside the current page of the
   * list, so it is fetched by phone when the list does not know it.
   */
  const openOrderById = useCallback(
    async (orderId: string, phone?: string | null) => {
      setHistoryRow(null);
      setCustomerPhone(null);
      const known = data?.items.find((row) => row.id === orderId);
      if (known) {
        setDrawerRow(known);
        return;
      }
      if (!phone) return;
      try {
        const result = await adminApi.listOrders({
          phone,
          page: 1,
          pageSize: 100,
        });
        const found = result.items.find((row) => row.id === orderId);
        if (found) setDrawerRow(found);
      } catch {
        // The order stays closed; the operator can find it in the list.
      }
    },
    [data],
  );

  const openRowMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, row: AdminOrderListRow) => {
      event.stopPropagation();
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      setRowMenu({
        row,
        x: Math.max(12, rect.right - 240),
        y: Math.min(rect.bottom + 6, window.innerHeight - 320),
      });
    },
    [setRowMenu],
  );

  const openDialog = useCallback((kind: RowDialogKind, row: AdminOrderListRow) => {
    setDialogRow(row);
    setRowDialog(kind);
  }, []);

  const openAssign = useCallback(
    async (row: AdminOrderListRow) => {
      try {
        const state = await adminApi.orderVerification(row.id);
        setAssignState(state);
        setAssignRow(row);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Request failed.");
      }
    },
    [setAssignRow, setAssignState],
  );

  const primaryAction = useCallback(
    (row: AdminOrderListRow) => {
      switch (row.orderStatus) {
        case "NEW":
        case "PENDING":
        case "QUESTION":
          return {
            label: row.verification?.total ? t("orders_action_continue") : t("orders_assign_tasks"),
            tone: "primary" as const,
          };
        case "CONFIRMED":
          return row.handoverCompletedAt
            ? { label: t("orders_action_ship"), tone: "primary" as const }
            : { label: t("orders_action_handover"), tone: "primary" as const };
        case "SHIPPING":
          return { label: t("orders_action_sign"), tone: "primary" as const };
        case "ABNORMAL":
          return { label: t("orders_action_exception"), tone: "primary" as const };
        default:
          return { label: t("orders_action_view"), tone: "secondary" as const };
      }
    },
    [t],
  );

  // --- export ----------------------------------------------------------------

  const exportCsv = useCallback(() => {
    const rows = data?.items ?? [];
    const head = [
      t("orders_col_no"),
      t("orders_col_customer"),
      t("orders_col_phone"),
      t("orders_col_status"),
      t("orders_col_product"),
      t("orders_col_sku"),
      t("orders_col_qty"),
      t("orders_col_unit"),
      t("orders_col_total"),
      t("orders_col_at"),
      t("orders_col_address"),
    ];
    const lines = [head.join(",")];
    for (const row of rows) {
      const cells = [
        row.orderNumber,
        row.customer.name ?? "",
        row.customer.normalizedPhone,
        row.orderStatus,
        row.items.map((item) => item.productNameSnapshot).join(" | "),
        row.items.map((item) => item.skuCodeSnapshot).join(" | "),
        String(row.items.reduce((sum, item) => sum + item.quantity, 0)),
        row.items.map((item) => item.unitPrice).join(" | "),
        row.grandTotal,
        row.createdAt,
        row.shippingAddress
          ? [
              row.shippingAddress.streetAddress,
              row.shippingAddress.barangay,
              row.shippingAddress.city,
              row.shippingAddress.province,
            ]
              .filter(Boolean)
              .join(", ")
          : "",
      ];
      lines.push(cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `luwag-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [data, t]);

  // --- filter helpers --------------------------------------------------------

  const activeFilterCount = [
    search,
    statusKey,
    payment,
    paymentStatus,
    confirmation,
    region,
    phone,
    sku,
    assignedTo,
    priority,
    classification,
    risk,
    verification,
    followUp,
    dateFrom,
    dateTo,
  ].filter(Boolean).length;

  /**
   * What the list is filtered by, in the words of the filter bar: every
   * active condition is named, so a missing order is never a mystery.
   */
  const filterChips = useMemo(() => {
    const chips: string[] = [];
    if (dateFrom || dateTo) {
      chips.push(
        `${t("orders_date_range")} ${dateFrom || "…"} → ${dateTo || "…"}`,
      );
    }
    if (statusKey) chips.push(`${t("orders_filter_status")} ${statusKey}`);
    if (payment) chips.push(`${t("orders_filter_payment")} ${payment}`);
    if (paymentStatus) {
      chips.push(`${t("orders_filter_payment_status")} ${paymentStatus}`);
    }
    if (confirmation) {
      chips.push(`${t("orders_filter_confirmation")} ${confirmation}`);
    }
    if (region) chips.push(`${t("orders_filter_region")} ${region}`);
    if (phone) chips.push(`${t("orders_filter_phone")} ${phone}`);
    if (sku) chips.push(`${t("orders_filter_product")} ${sku}`);
    if (assignedTo) {
      chips.push(
        `${t("orders_filter_assigned")} ${staffName(assignedTo) ?? "—"}`,
      );
    }
    if (priority) chips.push(`${t("orders_filter_priority")} ${priority}`);
    if (classification) {
      chips.push(`${t("orders_filter_classification")} ${classification}`);
    }
    if (risk) chips.push(`${t("orders_filter_risk")} ${risk}`);
    if (verification) {
      chips.push(`${t("orders_filter_verification")} ${verification}`);
    }
    if (search) chips.push(`${t("orders_filter_search")} ${search}`);
    return chips;
  }, [
    t,
    dateFrom,
    dateTo,
    statusKey,
    payment,
    paymentStatus,
    confirmation,
    region,
    phone,
    sku,
    assignedTo,
    staffName,
    priority,
    classification,
    risk,
    verification,
    search,
  ]);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  const onFilterChange = useCallback(
    (patch: Partial<WorkbenchFilterState>) => {
      const url: Record<string, string | null> = { page: null };
      if (patch.search !== undefined) url.search = patch.search || null;
      if (patch.status !== undefined) url.status = patch.status || null;
      if (patch.payment !== undefined) url.payment = patch.payment || null;
      if (patch.paymentStatus !== undefined)
        url.paymentStatus = patch.paymentStatus || null;
      if (patch.confirmation !== undefined)
        url.confirmation = patch.confirmation || null;
      if (patch.region !== undefined) url.region = patch.region || null;
      if (patch.phone !== undefined) url.phone = patch.phone || null;
      if (patch.sku !== undefined) url.sku = patch.sku || null;
      if (patch.owner !== undefined) url.assignedTo = patch.owner || null;
      if (patch.priority !== undefined) url.priority = patch.priority || null;
      if (patch.classification !== undefined)
        url.classification = patch.classification || null;
      if (patch.risk !== undefined) url.risk = patch.risk || null;
      if (patch.verification !== undefined) url.verification = patch.verification || null;
      if (patch.followUp !== undefined) url.followUp = patch.followUp || null;
      if (patch.dateFrom !== undefined) url.dateFrom = patch.dateFrom || null;
      if (patch.dateTo !== undefined) url.dateTo = patch.dateTo || null;
      if (patch.sort !== undefined) url.sort = patch.sort || null;
      patchParams(url);
    },
    [patchParams],
  );

  const rows = data?.items ?? [];

  return (
    <div className="w-full max-w-none px-4 py-5 md:px-8">
      <PageHeader
        title={t("orders_title")}
        count={counts?.total}
        subtitle={t("orders_subtitle")}
        actions={
          canConfirmPerm ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setShowCreate(true)}
            >
              {t("orders_new")}
            </Button>
          ) : undefined
        }
      />

      {/* The queue tabs: one look at every bucket of the day. */}
      <nav
        className="mt-4 flex gap-1 overflow-x-auto border-b border-border"
        role="tablist"
        aria-label={t("orders_tabs_label")}
      >
        {QUEUES.map((entry) => {
          const active = (queue || "all") === entry.key;
          const count = queueCounts?.[entry.key];
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() =>
                patchParams({
                  queue: entry.key === "all" ? null : entry.key,
                  status: null,
                  page: null,
                })
              }
              className={
                active
                  ? "whitespace-nowrap border-b-2 border-cta px-3 py-2 text-[13.5px] font-semibold text-cta"
                  : "whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13.5px] text-ink-secondary hover:text-ink"
              }
            >
              {t(entry.labelKey)}
              {typeof count === "number" ? (
                <span className="ml-1 font-medium tabular-nums opacity-70">
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* The filters of the table. */}
      <div className="mt-3">
        <WorkbenchFilterBar
          filters={filters}
          onChange={onFilterChange}
          onClear={clearFilters}
          assignees={assignees}
          statusOptions={[]}
          hiddenColumns={hiddenColumns}
          onToggleColumn={toggleColumn}
          onResetColumns={resetColumns}
          views={views}
          onApplyView={applyView}
          onSaveView={saveView}
          onDeleteView={deleteView}
          onExport={exportCsv}
          activeFilterCount={activeFilterCount}
        />
      </div>

      {/* What the list is currently showing. */}
      <p className="mt-2 text-[11.5px] text-ink-muted">
        {filterChips.length > 0
          ? `${t("orders_filter_summary")}：${filterChips.join(" · ")} —— ${t("orders_filter_hit")} ${data?.total ?? 0} ${t("orders_filter_summary_count")}`
          : `${t("orders_filter_total")} ${data?.total ?? 0} ${t("orders_filter_summary_count")}`}
      </p>

      {/* The table. */}
      <div className="mt-2">
        {loading ? (
          <TableSkeleton rows={8} cols={12} />
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-card p-6"
          >
            <p className="text-sm font-semibold text-ink">{t("orders_load_error")}</p>
            <p className="mt-1 text-sm text-ink-muted">{error}</p>
            <Button variant="secondary" size="md" onClick={reload} className="mt-4">
              {t("orders_retry")}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          activeFilterCount > 0 || queue !== "all" ? (
            <EmptyState
              title={t("orders_no_match")}
              hint={t("orders_clear_filters")}
              action={
                <Button variant="secondary" size="md" onClick={clearFilters}>
                  {t("orders_clear_filters")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("orders_empty")} />
          )
        ) : (
          <OrderTable
            rows={rows}
            columns={columns}
            widths={colWidths}
            onWidthChange={changeWidth}
            onResetWidth={resetWidth}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            staffName={staffName}
            onOpenDrawer={(row) => setDrawerRow(row)}
            onOpenVerify={(row) => setVerifyRow(row)}
            onOpenHistory={(row) => setHistoryRow(row)}
            onOpenCustomer={(row) =>
              openCustomerHistory(row.customer.normalizedPhone, row.orderNumber)
            }
            onOpenMenu={openRowMenu}
            primaryAction={primaryAction}
          />
        )}
      </div>

      {data && !loading && !error ? (
        <div className="mt-4">
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onChange={(nextPage) =>
              patchParams({ page: nextPage === 1 ? null : String(nextPage) })
            }
            labels={{
              prev: t("orders_pagination_prev"),
              next: t("orders_pagination_next"),
              page: t("orders_pagination_page"),
            }}
          />
        </div>
      ) : null}

      {/* The row menu: every action of one order. */}
      {rowMenu ? (
        <div
          className="fixed z-50 w-60 rounded-xl border border-border bg-card py-1 shadow-lg"
          style={{ left: rowMenu.x, top: rowMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-background"
            onClick={() => {
              const row = rowMenu.row;
              setRowMenu(null);
              setDrawerRow(row);
            }}
          >
            {t("orders_action_view")}
          </button>
          {canAssignPerm ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-background"
              onClick={() => {
                const row = rowMenu.row;
                setRowMenu(null);
                void openAssign(row);
              }}
            >
              {t("orders_assign_tasks")}
              <span className="pointer-events-none float-right text-[11px] text-ink-muted">ORDER_ASSIGN</span>
            </button>
          ) : null}
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-background"
            onClick={() => {
              const row = rowMenu.row;
              setRowMenu(null);
              setHistoryRow(row);
            }}
          >
            {t("orders_col_history")}
          </button>
          <div className="my-1 border-t border-border" />
          {canConfirmPerm ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-background"
              onClick={() => {
                const row = rowMenu.row;
                setRowMenu(null);
                openDialog("confirm", row);
              }}
            >
              {t("orders_menu_confirm")}
              <span className="pointer-events-none float-right text-[11px] text-ink-muted">ORDER_CONFIRM</span>
            </button>
          ) : null}
          {canCancelPerm ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-red-700 hover:bg-background"
              onClick={() => {
                const row = rowMenu.row;
                setRowMenu(null);
                openDialog("cancel", row);
              }}
            >
              {t("orders_menu_cancel")}
              <span className="pointer-events-none float-right text-[11px] text-ink-muted">ORDER_CANCEL</span>
            </button>
          ) : null}
          {canHandoverPerm &&
          rowMenu.row.orderStatus === "CONFIRMED" &&
          !rowMenu.row.handoverCompletedAt ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-background"
              onClick={() => {
                const row = rowMenu.row;
                setRowMenu(null);
                setFulfillment({ kind: "handover", row });
              }}
            >
              {t("orders_action_handover")}
              <span className="pointer-events-none float-right text-[11px] text-ink-muted">ORDER_HANDOVER</span>
            </button>
          ) : null}
          {canShipPerm &&
          ((rowMenu.row.orderStatus === "CONFIRMED" && rowMenu.row.handoverCompletedAt) ||
            rowMenu.row.orderStatus === "SHIPPING") ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-background"
              onClick={() => {
                const row = rowMenu.row;
                setRowMenu(null);
                setFulfillment({
                  kind: row.orderStatus === "SHIPPING" ? "sign" : "ship",
                  row,
                });
              }}
            >
              {rowMenu.row.orderStatus === "SHIPPING"
                ? t("orders_action_sign")
                : t("orders_action_ship")}
              <span className="pointer-events-none float-right text-[11px] text-ink-muted">SHIPMENT_CREATE</span>
            </button>
          ) : null}
          {canMergePerm ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-background"
              onClick={() => {
                const row = rowMenu.row;
                setRowMenu(null);
                openDialog("merge", row);
              }}
            >
              {t("orders_menu_merge")}
              <span className="pointer-events-none float-right text-[11px] text-ink-muted">ORDER_MERGE</span>
            </button>
          ) : null}
          <div className="my-1 border-t border-border" />
          {canRiskPerm ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-background"
              onClick={() => {
                const row = rowMenu.row;
                setRowMenu(null);
                openDialog("risk", row);
              }}
            >
              {t("orders_menu_risk")}
              <span className="pointer-events-none float-right text-[11px] text-ink-muted">ORDER_RISK_WRITE</span>
            </button>
          ) : null}
          {canNotePerm ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-background"
              onClick={() => {
                const row = rowMenu.row;
                setRowMenu(null);
                openDialog("note", row);
              }}
            >
              {t("orders_menu_note")}
              <span className="pointer-events-none float-right text-[11px] text-ink-muted">ORDER_NOTE_WRITE</span>
            </button>
          ) : null}
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-background"
            onClick={() => {
              const row = rowMenu.row;
              setRowMenu(null);
              openDialog("print", row);
            }}
          >
            {t("orders_menu_print")}
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-lg">
          {notice}
        </div>
      ) : null}

      {/* The drawer of one order. */}
      <OrderDrawer
        key={drawerRow?.id ?? "closed"}
        row={drawerRow}
        onClose={() => setDrawerRow(null)}
        staff={assignees}
        onOpenVerify={() => {
          if (drawerRow) setVerifyRow(drawerRow);
        }}
        onOpenHistory={() => {
          if (drawerRow) setHistoryRow(drawerRow);
        }}
        onOpenCustomer={() => {
          if (drawerRow)
            openCustomerHistory(drawerRow.customer.normalizedPhone, drawerRow.orderNumber);
        }}
        onOpenOrder={(orderId) => {
          void openOrderById(orderId, drawerRow?.customer.normalizedPhone ?? null);
        }}
        onAssign={() => {
          if (drawerRow) void openAssign(drawerRow);
        }}
        onConfirm={() => {
          if (drawerRow) openDialog("confirm", drawerRow);
        }}
        canConfirm={canConfirmPerm && (drawerRow?.riskFlags.length ?? 0) === 0}
        confirmBlockedReason={
          (drawerRow?.riskFlags.length ?? 0) > 0 ? t("orders_risk_unresolved") : null
        }
        canHandover={canHandoverPerm}
        canShip={canShipPerm}
        onOpenHandover={() => {
          if (drawerRow) setFulfillment({ kind: "handover", row: drawerRow });
        }}
        onOpenShip={() => {
          if (drawerRow) setFulfillment({ kind: "ship", row: drawerRow });
        }}
        onOpenSign={() => {
          if (drawerRow) setFulfillment({ kind: "sign", row: drawerRow });
        }}
        onChanged={reload}
      />

      {/* The checklist of one order. */}
      <VerificationDrawer
        orderId={verifyRow?.id ?? null}
        orderNumber={verifyRow?.orderNumber ?? ""}
        staff={assignees}
        onClose={() => setVerifyRow(null)}
        onChanged={reload}
      />

      {/* The assignment of the verification tasks. */}
      <AssignTasksDialog
        key={`assign-${assignRow?.id ?? "none"}`}
        open={assignRow !== null}
        orderId={assignRow?.id ?? null}
        staff={assignees}
        current={assignState}
        onClose={() => {
          setAssignRow(null);
          setAssignState(null);
        }}
        onSaved={async () => {
          setAssignRow(null);
          setAssignState(null);
          reload();
        }}
      />

      {/* The processing history of one order. It is rendered before the
          customer history, so the customer history is painted on top of it
          when the operator opens one from the other. */}
      <OrderHistoryDialog
        orderId={historyRow?.id ?? null}
        open={historyRow !== null}
        onClose={() => setHistoryRow(null)}
        staff={assignees}
        onOpenPhoneHistory={(phone) =>
          openCustomerHistory(phone, historyRow?.orderNumber ?? null)
        }
        onOpenOrder={(orderId) => {
          void openOrderById(orderId, historyRow?.customer.normalizedPhone ?? null);
        }}
      />

      {/* Every order of one phone number. */}
      <CustomerHistoryDialog
        phone={customerPhone}
        currentOrderNumber={customerOrderNumber}
        open={customerPhone !== null}
        onClose={() => setCustomerPhone(null)}
        onFilterByPhone={(phone) => {
          setCustomerPhone(null);
          patchParams({ phone, page: null });
        }}
      />

      {/* The actions behind the row menu. */}
      <OrderRowDialogs
        key={`${rowDialog}-${dialogRow?.id ?? "none"}`}
        kind={rowDialog}
        row={dialogRow}
        onClose={() => {
          setRowDialog(null);
          setDialogRow(null);
        }}
        onDone={() => {
          reload();
        }}
      />

      {fulfillment ? (
        <FulfillmentDialog
          key={`${fulfillment.kind}-${fulfillment.row.id}`}
          kind={fulfillment.kind}
          row={fulfillment.row}
          onClose={() => setFulfillment(null)}
          onDone={() => {
            setDrawerRow(null);
            reload();
          }}
        />
      ) : null}

      <NewOrderDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={reload}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Manual order entry (phone orders)                                   */
/* ------------------------------------------------------------------ */

function NewOrderDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useAdminI18n();
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    name: "",
    phone: "",
    province: "",
    city: "",
    streetAddress: "",
    barangay: "",
  });
  const [skuQuery, setSkuQuery] = useState("");
  const [skuOptions, setSkuOptions] = useState<
    { skuId: string; label: string; price: string | null }[]
  >([]);
  const [pickedSku, setPickedSku] = useState<{ skuId: string; label: string } | null>(null);
  const [createQty, setCreateQty] = useState(1);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = setTimeout(() => {
      adminApi
        .skuSearch(skuQuery)
        .then((opts) => {
          if (active) setSkuOptions(opts);
        })
        .catch(() => {
          // Non-fatal.
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, skuQuery]);

  async function submitCreate() {
    if (!pickedSku) {
      setFormError(t("orders_create_pick_product"));
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      await adminApi.createOrder({
        customer: {
          name: createForm.name,
          phone: createForm.phone,
          province: createForm.province,
          city: createForm.city,
          barangay: createForm.barangay || null,
          streetAddress: createForm.streetAddress,
        },
        items: [{ skuId: pickedSku.skuId, quantity: createQty }],
      });
      setPickedSku(null);
      setSkuQuery("");
      setCreateQty(1);
      setCreateForm({ name: "", phone: "", province: "", city: "", streetAddress: "", barangay: "" });
      onCreated();
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create the order.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("orders_new")} width="md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submitCreate();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("orders_create_name")} htmlFor="co-name">
            <input
              id="co-name"
              type="text"
              required
              value={createForm.name}
              onChange={(event) => setCreateForm((f) => ({ ...f, name: event.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
            />
          </Field>
          <Field label={t("orders_create_phone")} htmlFor="co-phone">
            <input
              id="co-phone"
              type="text"
              required
              placeholder="0917 123 4567"
              value={createForm.phone}
              onChange={(event) => setCreateForm((f) => ({ ...f, phone: event.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
            />
          </Field>
          <Field label={t("orders_create_province")} htmlFor="co-province">
            <input
              id="co-province"
              type="text"
              required
              value={createForm.province}
              onChange={(event) => setCreateForm((f) => ({ ...f, province: event.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
            />
          </Field>
          <Field label={t("orders_create_city")} htmlFor="co-city">
            <input
              id="co-city"
              type="text"
              required
              value={createForm.city}
              onChange={(event) => setCreateForm((f) => ({ ...f, city: event.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
            />
          </Field>
          <Field label={t("orders_create_street")} htmlFor="co-street">
            <input
              id="co-street"
              type="text"
              required
              value={createForm.streetAddress}
              onChange={(event) =>
                setCreateForm((f) => ({ ...f, streetAddress: event.target.value }))
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
            />
          </Field>
          <Field label={t("orders_create_barangay")} htmlFor="co-barangay">
            <input
              id="co-barangay"
              type="text"
              value={createForm.barangay}
              onChange={(event) => setCreateForm((f) => ({ ...f, barangay: event.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
            />
          </Field>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-background p-3">
          <Field label={t("orders_create_product")} htmlFor="co-sku">
            <input
              id="co-sku"
              type="text"
              placeholder={t("orders_create_product")}
              value={pickedSku ? pickedSku.label : skuQuery}
              onChange={(event) => {
                setPickedSku(null);
                setSkuQuery(event.target.value);
              }}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink"
            />
          </Field>
          {!pickedSku && skuOptions.length > 0 ? (
            <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border">
              {skuOptions.map((option) => (
                <li key={option.skuId}>
                  <button
                    type="button"
                    onClick={() => {
                      setPickedSku({ skuId: option.skuId, label: option.label });
                      setSkuOptions([]);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-ink hover:bg-primary-light/30"
                  >
                    <span className="truncate">{option.label}</span>
                    <span className="ml-3 whitespace-nowrap text-xs text-ink-secondary">
                      {option.price ?? "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 w-28">
            <Field label={t("orders_create_qty")} htmlFor="co-qty">
              <input
                id="co-qty"
                type="number"
                min={1}
                max={99}
                value={createQty}
                onChange={(event) => setCreateQty(Math.max(1, Number(event.target.value) || 1))}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>
        </div>
        {formError ? (
          <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">
            {formError}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={creating}
          >
            {t("orders_cancel")}
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={creating || !pickedSku}>
            {creating ? "…" : t("orders_create_submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-none px-4 py-5 md:px-8">
          <TableSkeleton rows={8} cols={12} />
        </div>
      }
    >
      <OrdersPageContent />
    </Suspense>
  );
}
