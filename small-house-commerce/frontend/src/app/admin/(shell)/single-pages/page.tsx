"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Badge, type BadgeTone } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { Button } from "@/components/ui/Button";
import { errorStatus } from "@/lib/admin-auth";
import {
  adminApi,
  type AdminLandingPageRow,
  type LandingEffectiveStatus,
  type LandingPageInput,
  type Paged,
} from "@/lib/admin-api";
import {
  emptyLandingForm,
  landingFormFromDetail,
  LandingPageForm,
  type LandingFormValue,
} from "./landing-page-form";

const PAGE_SIZE = 20;

const EFFECTIVE_TONE: Record<LandingEffectiveStatus, BadgeTone> = {
  LIVE: "green",
  SCHEDULED: "amber",
  ENDED: "neutral",
  DISABLED: "red",
};
const EFFECTIVE_LABEL: Record<LandingEffectiveStatus, string> = {
  LIVE: "进行中",
  SCHEDULED: "未开始",
  ENDED: "已结束",
  DISABLED: "已停用",
};

function formatModified(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function SinglePagesInner() {
  const searchParams = useSearchParams();
  const presetProductId = searchParams.get("productId");
  const { hasPermission } = useAdminAuth();
  const canManage = hasPermission("PRODUCT_MANAGE");

  const [rows, setRows] = useState<Paged<AdminLandingPageRow> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"updatedAt" | "title">("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [searchInput, setSearchInput] = useState("");
  const [effectiveInput, setEffectiveInput] = useState("");
  const [dateFromInput, setDateFromInput] = useState("");
  const [dateToInput, setDateToInput] = useState("");
  const [applied, setApplied] = useState<{
    search?: string;
    effectiveStatus?: LandingEffectiveStatus;
    dateFrom?: string;
    dateTo?: string;
  }>({});

  const [presetProduct, setPresetProduct] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogInitial, setDialogInitial] = useState<LandingFormValue>(emptyLandingForm);
  const [dialogProduct, setDialogProduct] = useState<{ id: string; name: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTitle, setBulkTitle] = useState("");
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!presetProductId) return;
    let active = true;
    adminApi
      .getProduct(presetProductId)
      .then((product) => {
        if (active) setPresetProduct({ id: product.id, name: product.name });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [presetProductId]);

  // Loading is DERIVED (orders-list pattern): nonce bumps re-run the query;
  // state writes happen only in promise continuations (set-state-in-effect).
  const [nonce, setNonce] = useState(0);
  const queryKey = [
    applied.search ?? "",
    applied.effectiveStatus ?? "",
    applied.dateFrom ?? "",
    applied.dateTo ?? "",
    presetProductId ?? "",
    sortBy,
    sortDir,
    String(page),
    String(nonce),
  ].join("|");
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const loading = fetchedKey !== queryKey;
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    adminApi
      .listLandingPages({
        search: applied.search,
        effectiveStatus: applied.effectiveStatus,
        dateFrom: applied.dateFrom,
        dateTo: applied.dateTo,
        productId: presetProductId ?? undefined,
        sortBy,
        sortDir,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((result) => {
        if (!active) return;
        setRows(result);
        setLoadError(null);
        setFetchedKey(queryKey);
        setSelected((current) => {
          const next = new Set<string>();
          for (const item of result.items) if (current.has(item.id)) next.add(item.id);
          return next;
        });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(
          errorStatus(err) === 403 ? "没有权限查看 Single Pages。" : "加载失败，请刷新重试。",
        );
        setFetchedKey(queryKey);
      });
    return () => {
      active = false;
    };
  }, [queryKey, applied, sortBy, sortDir, page, presetProductId]);

  const pageIds = useMemo(() => rows?.items.map((row) => row.id) ?? [], [rows]);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function applyFilters() {
    setPage(1);
    setApplied({
      search: searchInput.trim() || undefined,
      effectiveStatus: (effectiveInput || undefined) as LandingEffectiveStatus | undefined,
      dateFrom: dateFromInput || undefined,
      dateTo: dateToInput || undefined,
    });
  }

  function resetFilters() {
    setSearchInput("");
    setEffectiveInput("");
    setDateFromInput("");
    setDateToInput("");
    setPage(1);
    setApplied({});
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllOnPage(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function copyLink(row: AdminLandingPageRow) {
    const url = `${window.location.origin}/lp/${row.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(row.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* clipboard blocked: open link still works */
    }
  }

  function openCreate() {
    setDialogMode("create");
    setDialogInitial(emptyLandingForm);
    setDialogProduct(presetProduct);
    setEditingId(null);
    setDialogError(null);
    setDialogPending(false);
    setDialogOpen(true);
  }

  async function openEdit(row: AdminLandingPageRow) {
    setDialogMode("edit");
    setDialogError(null);
    setDialogPending(true);
    setDialogOpen(true);
    setEditingId(row.id);
    setDialogProduct({ id: row.productId, name: row.productName });
    try {
      const all = await adminApi.listProductLandingPages(row.productId);
      const detail = all.find((item) => item.id === row.id);
      if (!detail) throw new Error("not found");
      setDialogInitial(landingFormFromDetail(detail));
    } catch {
      setDialogError("加载落地页详情失败，请关闭重试。");
    } finally {
      setDialogPending(false);
    }
  }

  async function handleSubmit(productId: string, input: LandingPageInput) {
    setDialogPending(true);
    setDialogError(null);
    try {
      if (dialogMode === "create") {
        await adminApi.createLandingPage(productId, input);
      } else if (editingId) {
        // Slug is immutable after creation; the PATCH DTO strips it anyway, but
        // never send it from the edit form.
        await adminApi.updateLandingPage(editingId, stripSlug(input));
      }
      setDialogOpen(false);
      void reload();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "保存失败，请重试。");
    } finally {
      setDialogPending(false);
    }
  }

  async function submitBulk() {
    setBulkError(null);
    const title = bulkTitle.trim();
    if (!title || title.length > 200) {
      setBulkError("批量标题为 1–200 字。");
      return;
    }
    setBulkPending(true);
    try {
      const ids = [...selected];
      const result = await adminApi.bulkTitleLandingPages(ids, title);
      // Optimistic update so the table reacts immediately; reload reconciles.
      setRows((current) =>
        current
          ? {
              ...current,
              items: current.items.map((row) =>
                selected.has(row.id) ? { ...row, titleOverride: title } : row,
              ),
            }
          : current,
      );
      setBulkSuccess(`已更新 ${result.updated} 个页面的标题。`);
      setBulkOpen(false);
      setSelected(new Set());
      void reload();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "批量更新失败，请重试。");
    } finally {
      setBulkPending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Single Pages"
        count={rows?.total}
        actions={canManage ? <Button size="md" onClick={openCreate}>新建落地页</Button> : undefined}
      />

      <p className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-ink-secondary">
        每个优化师/广告组一个独立链接；访问量按会话去重；转化率 = 订单数 ÷ 访问会话数（取消/拒单不计），仅供投放参考；批量标题用于「圣诞促销」这类统一换主题，不影响网址、库存与评论。
      </p>

      {presetProduct ? (
        <p className="mt-3 text-sm text-ink-secondary">
          当前只看产品：<span className="font-semibold text-ink">{presetProduct.name}</span>
          {" · "}
          <Link href="/admin/single-pages" className="text-cta hover:underline">
            查看全部
          </Link>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="搜索（标题 / 内部名 / FB编号 / 产品名）">
          <TextInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters();
            }}
          />
        </Field>
        <Field label="生效状态">
          <Select
            value={effectiveInput}
            onChange={(e) => setEffectiveInput(e.target.value)}
          >
            <option value="">全部</option>
            <option value="LIVE">进行中</option>
            <option value="SCHEDULED">未开始</option>
            <option value="ENDED">已结束</option>
            <option value="DISABLED">已停用</option>
          </Select>
        </Field>
        <Field label="修改起">
          <TextInput type="date" value={dateFromInput} onChange={(e) => setDateFromInput(e.target.value)} />
        </Field>
        <Field label="修改止">
          <TextInput type="date" value={dateToInput} onChange={(e) => setDateToInput(e.target.value)} />
        </Field>
        <Button variant="secondary" size="md" onClick={applyFilters}>
          筛选
        </Button>
        <Button variant="text" size="md" onClick={resetFilters}>
          重置
        </Button>
      </div>

      {bulkSuccess ? (
        <p className="mt-3 text-sm font-medium text-ink-secondary" role="status">
          {bulkSuccess}
        </p>
      ) : null}

      {selected.size > 0 && canManage ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <span className="text-sm font-semibold text-ink">已选 {selected.size} 项</span>
          <Button size="md" variant="secondary" onClick={() => { setBulkTitle(""); setBulkError(null); setBulkSuccess(null); setBulkOpen(true); }}>
            批量改标题
          </Button>
          <Button variant="text" size="md" onClick={() => setSelected(new Set())}>
            清除选择
          </Button>
        </div>
      ) : null}

      <div className="mt-4">
        {loadError ? (
          <div role="alert" className="rounded-xl border border-border bg-card p-6">
            <p className="text-sm font-semibold text-ink">{loadError}</p>
            <Button variant="secondary" size="md" onClick={() => void reload()} className="mt-4">
              Retry
            </Button>
          </div>
        ) : rows === null || loading ? (
          <TableSkeleton rows={6} cols={10} />
        ) : rows.items.length === 0 ? (
          <EmptyState
            title="还没有落地页。"
            hint="给产品创建第一个独立链接，用于不同优化师或广告组的投放页面。"
            action={canManage ? <Button size="md" onClick={openCreate}>新建落地页</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="全选本页"
                      checked={allOnPageSelected}
                      disabled={!canManage}
                      onChange={(e) => toggleAllOnPage(e.target.checked)}
                    />
                  </th>
                  <th className="px-3 py-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-cta"
                      onClick={() => {
                        if (sortBy !== "title") {
                          setSortBy("title");
                          setSortDir("asc");
                        } else {
                          setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
                        }
                        setPage(1);
                      }}
                    >
                      单页标题
                      <span aria-hidden>{sortBy === "title" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                  </th>
                  <th className="px-3 py-3">产品型号</th>
                  <th className="px-3 py-3">FB目录编号</th>
                  <th className="px-3 py-3">页面链接</th>
                  <th className="px-3 py-3 text-right">访问量</th>
                  <th className="px-3 py-3 text-right">订单</th>
                  <th className="px-3 py-3 text-right">转化率</th>
                  <th className="px-3 py-3">生效状态</th>
                  <th className="px-3 py-3">修改时间</th>
                  <th className="px-3 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.items.map((row) => (
                  <tr key={row.id} className="border-b border-border align-middle last:border-0">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${row.titleOverride || row.name}`}
                        checked={selected.has(row.id)}
                        disabled={!canManage}
                        onChange={(e) => toggleOne(row.id, e.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-ink">{row.titleOverride || row.name}</p>
                      <p className="text-xs text-ink-muted">{row.name}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/admin/products/${row.productId}/edit`}
                        className="text-ink-secondary hover:text-cta hover:underline"
                      >
                        {row.productName}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-ink-secondary">{row.adCode || "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <Link
                          href={`/lp/${row.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cta hover:underline"
                        >
                          /lp/{row.slug}
                        </Link>
                        <button
                          type="button"
                          className="text-xs text-ink-muted hover:text-cta"
                          onClick={() => void copyLink(row)}
                        >
                          {copiedId === row.id ? "已复制" : "复制"}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-ink">{row.views}</td>
                    <td className="px-3 py-3 text-right font-medium text-ink">{row.orders}</td>
                    <td className="px-3 py-3 text-right font-medium text-ink">
                      {(row.conversionRate * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        value={EFFECTIVE_LABEL[row.effectiveStatus]}
                        tone={EFFECTIVE_TONE[row.effectiveStatus]}
                      />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-muted">
                      {formatModified(row.updatedAt)}
                    </td>
                    <td className="px-3 py-3">
                      {canManage ? (
                        <button
                          type="button"
                          aria-label={`编辑 ${row.titleOverride || row.name}`}
                          className="text-base text-ink-secondary hover:text-cta"
                          onClick={() => void openEdit(row)}
                        >
                          ✎
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rows && rows.total > PAGE_SIZE ? (
        <div className="mt-6">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={rows.total}
            onChange={setPage}
          />
        </div>
      ) : null}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={dialogMode === "create" ? "新建落地页" : "编辑落地页"}
      >
        {dialogPending ? (
          <p className="py-8 text-center text-sm text-ink-muted">加载中…</p>
        ) : (
          <>
            {dialogError ? (
              <p className="mb-3 rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700" role="alert">
                {dialogError}
              </p>
            ) : null}
            <LandingPageForm
              key={`${dialogMode}-${editingId ?? "new"}-${dialogOpen}`}
              mode={dialogMode}
              initial={dialogInitial}
              lockedProduct={dialogProduct}
              pending={dialogPending}
              onSubmit={handleSubmit}
              onCancel={() => setDialogOpen(false)}
            />
          </>
        )}
      </Dialog>

      <Dialog open={bulkOpen} onClose={() => setBulkOpen(false)} title="批量修改标题">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-secondary">
            将选中的 {selected.size} 个页面标题统一覆盖为同一文案（例如「圣诞促销」活动主题），不影响网址、库存与评论。
          </p>
          {bulkError ? (
            <p className="rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700" role="alert">
              {bulkError}
            </p>
          ) : null}
          <Field label="新的统一标题">
            <TextInput value={bulkTitle} maxLength={200} onChange={(e) => setBulkTitle(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="md" onClick={() => setBulkOpen(false)} disabled={bulkPending}>
              取消
            </Button>
            <Button size="md" onClick={() => void submitBulk()} disabled={bulkPending}>
              {bulkPending ? "更新中…" : `更新 ${selected.size} 项`}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function stripSlug(input: LandingPageInput): Partial<LandingPageInput> {
  const { slug, ...rest } = input;
  void slug;
  return rest;
}

export default function SinglePagesPage() {
  // useSearchParams must sit under Suspense for the static-build boundary.
  return (
    <Suspense fallback={<TableSkeleton rows={6} cols={10} />}>
      <SinglePagesInner />
    </Suspense>
  );
}
