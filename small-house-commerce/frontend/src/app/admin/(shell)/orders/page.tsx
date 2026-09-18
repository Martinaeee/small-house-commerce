"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Badge } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  formatAmount,
  type AdminOrderListRow,
  type AdminOrderRow,
  type OrderStatus,
  type Paged,
} from "@/lib/admin-api";

// OrderStatus union, in declaration order (admin-api.ts).
const ORDER_STATUSES: OrderStatus[] = [
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
];

// Confirm blocked set (brief Step 3): cancelled / denied / in-or-after
// shipping is not confirmable; CONFIRMED confirmation status is checked
// separately below.
const CONFIRM_BLOCKED = new Set<OrderStatus>([
  "CANCELLED",
  "DENIED",
  "SHIPPING",
  "SIGNED",
]);

// Cancel blocked set (brief Step 3): terminal states plus SHIPPING.
const CANCEL_BLOCKED = new Set<OrderStatus>([
  "CANCELLED",
  "DENIED",
  "SIGNED",
  "AFTER_SALES",
  "SHIPPING",
]);

// After a transition into one of these the list is re-queried for server
// truth (brief Step 3).
const TERMINAL_STATUSES = new Set<OrderStatus>([
  "CANCELLED",
  "DENIED",
  "SIGNED",
  "AFTER_SALES",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Customer classification values (CUSTOMER_RISK_SPEC §7) and risk flag types
// (DATABASE §47) used by the workbench filters.
const CLASSIFICATIONS = ["NEW", "AGAIN", "RPT", "RECHECK"];
const RISK_TYPES = ["POSSIBLE_DUPLICATE", "CUSTOMER_RECHECK", "CUSTOMER_BLOCKED"];

// Preferred delivery date is a calendar date (@db.Date, UTC midnight on the
// wire): same en-PH date style as the Created column, minus a meaningless
// time component. Missing/invalid values render as an em dash.
function formatPreferredDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Customer classification badge (CUSTOMER_RISK_SPEC §16 display rules):
// 🟢 AGAIN / 🟡 RPT / 🔴 RECHECK / neutral NEW. Color is enhancement only —
// the raw value is always rendered.
function ClassificationBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-muted">—</span>;
  const tone =
    value === "RECHECK"
      ? "bg-red-100 text-red-700"
      : value === "RPT"
        ? "bg-amber-100 text-amber-700"
        : value === "AGAIN"
          ? "bg-green-100 text-green-700"
          : "bg-primary-light/40 text-cta";
  const dot =
    value === "RECHECK"
      ? "🔴"
      : value === "RPT"
        ? "🟡"
        : value === "AGAIN"
          ? "🟢"
          : "⚪";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      <span aria-hidden>{dot}</span>
      {value}
    </span>
  );
}

type ActionDialog = { id: string; kind: "confirm" | "cancel" } | null;

function OrdersPageContent() {
  const { hasPermission } = useAdminAuth();
  const canConfirmPerm = hasPermission("ORDER_CONFIRM");
  const canCancelPerm = hasPermission("ORDER_CANCEL");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // --- URL params: source of truth (brief Step 1) ---------------------------

  const search = searchParams.get("search")?.trim() ?? "";
  const rawStatus = searchParams.get("status");
  const status = ORDER_STATUSES.includes(rawStatus as OrderStatus)
    ? (rawStatus as OrderStatus)
    : "";
  const rawClassification = searchParams.get("classification") ?? "";
  const classification = CLASSIFICATIONS.includes(rawClassification)
    ? rawClassification
    : "";
  const assignedTo = searchParams.get("assignedTo") ?? "";
  const rawRisk = searchParams.get("risk") ?? "";
  const risk = RISK_TYPES.includes(rawRisk) ? rawRisk : "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const page =
    Math.max(1, Number.parseInt(searchParams.get("page") ?? "", 10)) || 1;

  const filtersActive = Boolean(
    search || status || classification || assignedTo || risk || dateFrom || dateTo,
  );

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

  // Search box keeps instant local state; changes sync to the URL after a
  // 300ms debounce. URL -> input reconciliation happens during render (same
  // pattern as AdminShell's route-state sync) so external navigation
  // (reset / reload / back-forward) updates the field without an effect.
  const [searchInput, setSearchInput] = useState(search);
  const [syncedSearch, setSyncedSearch] = useState(search);
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setSearchInput(search);
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      const value = searchInput.trim();
      if (value !== search) {
        // Any filter change resets to page 1.
        patchParams({ search: value || null, page: null });
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput, search, patchParams]);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  // --- assignee options for the staff filter + inline assignment ------------
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let active = true;
    adminApi
      .listAssignees()
      .then((users) => {
        if (active) setAssignees(users);
      })
      .catch(() => {
        // Non-fatal: filters/assignment just show no options.
      });
    return () => {
      active = false;
    };
  }, []);

  // --- list data ------------------------------------------------------------

  const [data, setData] = useState<Paged<AdminOrderListRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force a re-run of the current query (Retry / resync).
  const [nonce, setNonce] = useState(0);

  const queryKey = [status, classification, assignedTo, risk, search, dateFrom, dateTo, String(page), String(nonce)].join("|");
  // Loading is DERIVED: it flips true the moment the keyed query changes and
  // flips back false when that exact query settles — no setState in the
  // fetch effect body (react-hooks/set-state-in-effect).
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const loading = fetchedKey !== queryKey;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    adminApi
      .listOrders({
        status: status || undefined,
        classification: classification || undefined,
        assignedTo: assignedTo || undefined,
        risk: risk || undefined,
        search: search || undefined,
        dateFrom: DATE_RE.test(dateFrom) ? dateFrom : undefined,
        dateTo: DATE_RE.test(dateTo) ? dateTo : undefined,
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
  }, [queryKey, status, classification, assignedTo, risk, search, dateFrom, dateTo, page]);

  // --- inline confirm / cancel ----------------------------------------------

  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const activeRow = useMemo(
    () =>
      dialog ? data?.items.find((row) => row.id === dialog.id) ?? null : null,
    [dialog, data],
  );

  const openDialog = useCallback((id: string, kind: "confirm" | "cancel") => {
    setActionError(null);
    setDialog({ id, kind });
  }, []);

  const closeDialog = useCallback(() => {
    // Do not allow dismissal while the mutation is in flight.
    if (actionPending) return;
    setDialog(null);
    setActionError(null);
  }, [actionPending]);

  const submitAction = useCallback(async () => {
    if (!dialog) return;
    setActionPending(true);
    setActionError(null);
    try {
      const updated: AdminOrderRow =
        dialog.kind === "confirm"
          ? await adminApi.confirmOrder(dialog.id)
          : await adminApi.cancelOrder(dialog.id);

      // m1 wire contract: confirm/cancel return BARE Order rows (no
      // customer/items includes). Patch ONLY the row's status fields from
      // the response — never replace the whole row object.
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((row) =>
                row.id === dialog.id
                  ? {
                      ...row,
                      orderStatus: updated.orderStatus,
                      confirmationStatus: updated.confirmationStatus,
                      paymentStatus: updated.paymentStatus,
                    }
                  : row,
              ),
            }
          : prev,
      );

      setDialog(null);
      setActionError(null);
      // Terminal transition (e.g. cancel): re-run the current query for
      // server truth.
      if (TERMINAL_STATUSES.has(updated.orderStatus)) {
        setNonce((n) => n + 1);
      }
    } catch (err) {
      // 400/409: keep the dialog open and surface the backend message
      // verbatim; resync the list against server truth (spec §8.3).
      setActionError(
        err instanceof Error ? err.message : "Request failed.",
      );
      setNonce((n) => n + 1);
    } finally {
      setActionPending(false);
    }
  }, [dialog]);

  const onDialogSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitAction();
  };

  // --- inline assignment -----------------------------------------------------

  const assignRow = useCallback(async (id: string, assignedToId: string) => {
    try {
      await adminApi.assignOrder(id, assignedToId);
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((row) =>
                row.id === id
                  ? {
                      ...row,
                      assignedTo: {
                        id: assignedToId,
                        name:
                          assignees.find((u) => u.id === assignedToId)?.name ?? null,
                      },
                    }
                  : row,
              ),
            }
          : prev,
      );
    } catch (err) {
      // Surface quietly: the list stays consistent with server truth on the
      // next fetch; a failed assignment should not block the page.
      console.error("assign failed", err);
    }
  }, [assignees]);

  const canConfirmRow = (row: AdminOrderListRow): boolean =>
    canConfirmPerm &&
    !CONFIRM_BLOCKED.has(row.orderStatus) &&
    row.confirmationStatus !== "CONFIRMED";

  const canCancelRow = (row: AdminOrderListRow): boolean =>
    canCancelPerm && !CANCEL_BLOCKED.has(row.orderStatus);

  // --- render ---------------------------------------------------------------

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader title="Orders" count={data?.total} />

      {/* Filter bar */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="md:min-w-[220px] md:flex-1">
            <Field label="Search" htmlFor="orders-search">
              <TextInput
                id="orders-search"
                type="search"
                placeholder="Order number, name or phone"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </Field>
          </div>
          <div className="md:w-44">
            <Field label="Status" htmlFor="orders-status">
              <Select
                id="orders-status"
                value={status}
                onChange={(e) =>
                  patchParams({ status: e.target.value || null, page: null })
                }
              >
                <option value="">All statuses</option>
                {ORDER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="md:w-44">
            <Field label="Classification" htmlFor="orders-classification">
              <Select
                id="orders-classification"
                value={classification}
                onChange={(e) =>
                  patchParams({ classification: e.target.value || null, page: null })
                }
              >
                <option value="">All classifications</option>
                {CLASSIFICATIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="md:w-44">
            <Field label="Assigned To" htmlFor="orders-assigned">
              <Select
                id="orders-assigned"
                value={assignedTo}
                onChange={(e) =>
                  patchParams({ assignedTo: e.target.value || null, page: null })
                }
              >
                <option value="">All staff</option>
                {assignees.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? "—"}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="md:w-44">
            <Field label="Risk" htmlFor="orders-risk">
              <Select
                id="orders-risk"
                value={risk}
                onChange={(e) =>
                  patchParams({ risk: e.target.value || null, page: null })
                }
              >
                <option value="">All risks</option>
                {RISK_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="md:w-40">
            <Field label="From" htmlFor="orders-date-from">
              <TextInput
                id="orders-date-from"
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) =>
                  patchParams({ dateFrom: e.target.value || null, page: null })
                }
              />
            </Field>
          </div>
          <div className="md:w-40">
            <Field label="To" htmlFor="orders-date-to">
              <TextInput
                id="orders-date-to"
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) =>
                  patchParams({ dateTo: e.target.value || null, page: null })
                }
              />
            </Field>
          </div>
          <Button
            variant="secondary"
            size="md"
            onClick={clearFilters}
            disabled={!filtersActive && searchInput === ""}
          >
            Clear filters
          </Button>
        </div>
      </div>

      {/* Table / states */}
      <div className="mt-4">
        {loading ? (
          <TableSkeleton rows={6} cols={10} />
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-card p-6"
          >
            <p className="text-sm font-semibold text-ink">
              Couldn&apos;t load orders.
            </p>
            <p className="mt-1 text-sm text-ink-muted">{error}</p>
            <Button
              variant="secondary"
              size="md"
              onClick={reload}
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        ) : data && data.items.length === 0 ? (
          filtersActive ? (
            <EmptyState
              title="No orders found."
              hint="Try clearing the filters."
              action={
                <Button variant="secondary" size="md" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState title="No orders yet." />
          )
        ) : (
          <ul className="flex flex-col gap-3">
            {data?.items.map((row) => {
              const showConfirm = canConfirmRow(row);
              const showCancel = canCancelRow(row);
              const rowBusy = actionPending && dialog?.id === row.id;
              const firstItem = row.items[0];
              return (
                <li
                  key={row.id}
                  className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-primary-light/10 sm:p-5"
                >
                  {/* Row header */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Link
                      href={`/admin/orders/${row.id}`}
                      className="text-base font-semibold text-cta hover:underline"
                    >
                      {row.orderNumber}
                    </Link>
                    <ClassificationBadge value={row.customerClassification} />
                    {row.riskFlags && row.riskFlags.length > 0 ? (
                      <span
                        title={
                          row.riskFlags[0]?.reason ?? undefined
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"
                      >
                        ⚠ {row.riskFlags[0]?.flagType === "POSSIBLE_DUPLICATE" ? "Duplicate" : row.riskFlags[0]?.flagType}
                      </span>
                    ) : null}
                    <span className="ml-auto flex items-center gap-2">
                      {showConfirm ? (
                        <button
                          type="button"
                          onClick={() => openDialog(row.id, "confirm")}
                          disabled={rowBusy}
                          className="rounded-lg bg-cta px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Confirm
                        </button>
                      ) : null}
                      {showCancel ? (
                        <button
                          type="button"
                          onClick={() => openDialog(row.id, "cancel")}
                          disabled={rowBusy}
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      ) : null}
                    </span>
                  </div>

                  {/* Key fields */}
                  <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
                    <div>
                      <div className="text-xs text-ink-muted">Customer</div>
                      <div className="text-ink">{row.customer.name ?? "—"}</div>
                      <div className="text-xs text-ink-secondary">
                        {row.customer.normalizedPhone}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted">Created</div>
                      <div className="text-ink-secondary">
                        {new Date(row.createdAt).toLocaleString("en-PH", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      {row.preferredDeliveryDate ? (
                        <div className="text-xs text-ink-muted">
                          Preferred: {formatPreferredDate(row.preferredDeliveryDate)}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted">Items</div>
                      <div className="text-ink">{row.items.length} items</div>
                      {firstItem ? (
                        <div
                          className="max-w-[180px] truncate text-xs text-ink-muted"
                          title={firstItem.productNameSnapshot}
                        >
                          {firstItem.productNameSnapshot}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted">Total</div>
                      <div className="font-semibold text-ink">
                        {formatAmount(row.grandTotal, row.currency)}
                      </div>
                    </div>
                  </div>

                  {/* Status row */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
                    <Badge value={row.orderStatus} />
                    <Badge value={row.confirmationStatus} />
                    <Badge value={row.paymentStatus} />
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-ink-muted">Assigned</span>
                      {assignees.length > 0 ? (
                        <select
                          value={row.assignedTo?.id ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value) void assignRow(row.id, value);
                          }}
                          aria-label="Assign order"
                          className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-ink"
                        >
                          <option value="">—</option>
                          {assignees.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name ?? "—"}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-ink-muted">—</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {data && !loading && !error ? (
        <div className="mt-6">
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onChange={(nextPage) =>
              patchParams({ page: nextPage === 1 ? null : String(nextPage) })
            }
          />
        </div>
      ) : null}

      <Dialog
        open={dialog !== null}
        onClose={closeDialog}
        title={dialog?.kind === "cancel" ? "Cancel order" : "Confirm order"}
        width="sm"
      >
        {activeRow ? (
          <form onSubmit={onDialogSubmit}>
            <p className="text-sm text-ink-secondary">
              {dialog?.kind === "cancel"
                ? `Cancel order ${activeRow.orderNumber}? Reserved stock is released.`
                : `Confirm order ${activeRow.orderNumber}? This marks it confirmed for fulfillment.`}
            </p>
            {actionError ? (
              <p
                role="alert"
                className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800"
              >
                {actionError}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={closeDialog}
                disabled={actionPending}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={actionPending}
              >
                {actionPending
                  ? "Working…"
                  : dialog?.kind === "cancel"
                    ? "Cancel order"
                    : "Confirm"}
              </Button>
            </div>
          </form>
        ) : actionError ? (
          <p
            role="alert"
            className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800"
          >
            {actionError}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}

export default function AdminOrdersPage() {
  // useSearchParams requires a Suspense boundary for prerender (m6).
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
          <TableSkeleton rows={6} cols={10} />
        </div>
      }
    >
      <OrdersPageContent />
    </Suspense>
  );
}
