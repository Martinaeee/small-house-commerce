"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "./PageHeader";
import { Badge } from "./Badge";
import { Dialog } from "./Dialog";
import { Field, Select, TextInput } from "./Field";
import {
  HeroStyleFields,
  heroStyleFromForm,
  toHeroStyleFormValue,
  type HeroStyleFormValue,
} from "./HeroStyleFields";
import { LivePreview, StorefrontPreview } from "./PreviewPane";
import { HeroBanner } from "@/components/product/HeroBanner";
import { Button } from "@/components/ui/Button";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { adminApi, type AdminCategoryNode, type AdminCollectionRow, type AdminProduct } from "@/lib/admin-api";
import { api } from "@/lib/api";
import {
  GROUP_KIND_LABELS,
  buildUnifiedGroups,
  flattenUnifiedGroups,
  type UnifiedGroupRow,
} from "@/lib/admin-grouping-model";

type Tab = "all" | "categories" | "marketing";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全部分组" },
  { key: "categories", label: "商品分类" },
  { key: "marketing", label: "营销集合" },
];

function countText(counts: UnifiedGroupRow["counts"]): string {
  return `含子类 ${counts.subtree} · 在售 ${counts.active}`;
}

function detailText(counts: UnifiedGroupRow["counts"]): string {
  return `直属 ${counts.direct} · 成员 ${counts.memberCount}`;
}

async function fetchMemberIds(slug: string): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  for (;;) {
    const res = await api.getCollectionProducts(slug, page);
    ids.push(...res.items.map((item) => item.id));
    if (ids.length >= res.total || res.items.length === 0) break;
    page += 1;
  }
  return ids;
}

async function fetchAllProducts(): Promise<AdminProduct[]> {
  const out: AdminProduct[] = [];
  let page = 1;
  for (;;) {
    const res = await adminApi.listProducts({ page, pageSize: 100 });
    out.push(...res.items);
    if (out.length >= res.total || res.items.length === 0) break;
    page += 1;
  }
  return out;
}

function ProductThumb({ product }: { product: AdminProduct }) {
  const url = product.images?.[0]?.url ?? null;
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail of an already-uploaded shared asset.
    <img
      src={url}
      alt=""
      className="h-10 w-10 shrink-0 rounded-lg border border-border object-cover"
    />
  ) : (
    <PlaceholderImage
      label={product.name}
      className="h-10 w-10 shrink-0 overflow-hidden rounded-lg"
    />
  );
}

function skuCodesFor(product: AdminProduct): string[] {
  return product.variants
    .map((variant) => variant.sku?.skuCode)
    .filter((code): code is string => Boolean(code));
}

export function UnifiedGroupsDraft() {
  const [categories, setCategories] = useState<AdminCategoryNode[] | null>(null);
  const [collections, setCollections] = useState<AdminCollectionRow[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [memberIdsBySlug, setMemberIdsBySlug] = useState<Record<string, string[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [editor, setEditor] = useState<{
    row: UnifiedGroupRow | null;
    parentId?: string;
  } | null>(null);
  const [memberOverrides, setMemberOverrides] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cats, cols, prods] = await Promise.all([
          adminApi.listCategories(),
          adminApi.listCollections(),
          fetchAllProducts(),
        ]);
        const members: Record<string, string[]> = {};
        await Promise.all(
          cols.items.map(async (collection) => {
            members[collection.slug] = await fetchMemberIds(collection.slug);
          }),
        );
        if (cancelled) return;
        setCategories(cats);
        setCollections(cols.items);
        setProducts(prods);
        setMemberIdsBySlug(members);
      } catch {
        if (!cancelled) setLoadError("无法读取分组数据，请确认已登录后台并启动本地服务。");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveMembers = useMemo(
    () => ({ ...memberIdsBySlug, ...memberOverrides }),
    [memberIdsBySlug, memberOverrides],
  );

  const rows = useMemo(() => {
    if (!categories) return [];
    return buildUnifiedGroups({
      categories,
      collections,
      products: products.map((product) => ({
        id: product.id,
        status: product.status,
        categoryId: product.categoryId,
      })),
      memberIdsBySlug: effectiveMembers,
    });
  }, [categories, collections, products, effectiveMembers]);

  const visibleRows = useMemo(() => {
    const filtered =
      tab === "categories"
        ? rows.filter((row) => row.kind === "CATEGORY")
        : tab === "marketing"
          ? rows.filter((row) => row.kind !== "CATEGORY")
          : rows;
    return flattenUnifiedGroups(filtered, expanded);
  }, [rows, tab, expanded]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const closeEditor = useCallback(() => setEditor(null), []);

  const applyDemoSave = useCallback(
    (slug: string | null, memberIds: string[]) => {
      if (slug) {
        setMemberOverrides((prev) => ({ ...prev, [slug]: memberIds }));
      }
      setEditor(null);
      setNotice(
        "演示模式：更改只作用于本次会话，没有写入数据库。正式接线在阶段 C 完成。",
      );
    },
    [],
  );

  if (loadError) {
    return (
      <div className="w-full max-w-none px-4 py-6 md:px-8">
        <PageHeader title="商品分组（统一草稿）" />
        <p role="alert" className="mt-4 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-none flex-col gap-4 px-4 py-6 md:px-8">
      <PageHeader
        title="商品分组（统一草稿）"
        subtitle="一个列表管理商品分类与营销集合。商品分类按主分组自动归属，营销集合按成员名单展示。"
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setAssignmentOpen(true)}
            >
              商品归属交互稿
            </Button>
            <Button type="button" variant="primary" size="md" onClick={() => setEditor({ row: null })}>
              新建分组
            </Button>
          </>
        }
      />

      <div
        role="status"
        className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        本地草稿演示 · 不写数据库；计数按当前本地数据实时计算。保存按钮只更新本次会话。
      </div>

      {notice ? (
        <p role="status" className="rounded-lg bg-primary-light/40 px-3 py-2 text-sm text-ink-secondary">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="分组筛选">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={
              tab === entry.key
                ? "rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-white"
                : "rounded-full border border-border bg-card px-4 py-1.5 text-sm font-semibold text-ink-secondary hover:text-cta"
            }
          >
            {entry.label}
          </button>
        ))}
        <details className="ml-auto rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-ink-secondary">
          <summary className="cursor-pointer font-semibold text-ink">计数口径</summary>
          <p className="mt-1 max-w-xs leading-relaxed">
            含子类 = 主分组在本节点子树内的商品 ∪ 挂在本节点/后代上的成员，去重；
            在售 = 其中 ACTIVE 的数量；直属 = 主分组正好在本节点的商品；成员 = 显式加入的成员。
          </p>
        </details>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <caption className="sr-only">统一商品分组草稿列表</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
              <th className="px-4 py-3" scope="col">分组名称</th>
              <th className="px-4 py-3" scope="col">类型</th>
              <th className="px-4 py-3" scope="col">商品数</th>
              <th className="px-4 py-3" scope="col">状态</th>
              <th className="px-4 py-3" scope="col">排序</th>
              <th className="px-4 py-3" scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-3">
                  <div
                    className="flex items-center gap-1.5"
                    style={{ paddingLeft: row.depth * 20 }}
                  >
                    {row.children.length > 0 ? (
                      <button
                        type="button"
                        aria-label={
                          expanded.has(row.id)
                            ? `收起子分组 ${row.name}`
                            : `展开子分组 ${row.name}`
                        }
                        onClick={() => toggleExpanded(row.id)}
                        className="w-5 rounded text-xs text-ink-muted hover:bg-primary-light/40 hover:text-cta"
                      >
                        {expanded.has(row.id) ? "▾" : "▸"}
                      </button>
                    ) : (
                      <span className="w-5" aria-hidden />
                    )}
                    <span className="font-semibold text-ink">{row.name}</span>
                  </div>
                  <div
                    className="mt-0.5 font-mono text-xs text-ink-muted"
                    style={{ paddingLeft: row.depth * 20 + 26 }}
                  >
                    /{row.slug}
                  </div>
                </td>
                <td className="px-4 py-3 text-ink-secondary">
                  {GROUP_KIND_LABELS[row.kind]}
                </td>
                <td className="px-4 py-3">
                  {row.kind === "CATEGORY" ? (
                    <>
                      <div className="font-semibold text-ink">{countText(row.counts)}</div>
                      <div className="mt-0.5 text-xs text-ink-muted">{detailText(row.counts)}</div>
                    </>
                  ) : (
                    <>
                      <div className="font-semibold text-ink">
                        成员 {row.counts.memberCount} · 在售 {row.counts.active}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-muted">营销/场景成员名单</div>
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    value={row.status}
                    tone={row.status === "ACTIVE" ? "green" : undefined}
                  />
                </td>
                <td className="px-4 py-3 text-ink-secondary">{row.sortOrder}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setEditor({ row })}
                      className="rounded px-2 py-1 text-cta hover:bg-primary-light/40"
                    >
                      编辑
                    </button>
                    {row.kind === "CATEGORY" ? (
                      <button
                        type="button"
                        onClick={() => setEditor({ row: null, parentId: row.id })}
                        className="rounded px-2 py-1 text-ink-secondary hover:bg-primary-light/40"
                      >
                        新建子分组
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled
                      title="演示模式不执行删除"
                      className="cursor-not-allowed rounded px-2 py-1 text-ink-muted"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editor ? (
        <UnifiedGroupEditor
          key={editor.row?.id ?? editor.parentId ?? "create"}
          row={editor.row}
          initialParentId={editor.parentId}
          categories={categories ?? []}
          products={products}
          memberIds={
            editor.row ? effectiveMembers[editor.row.slug] ?? [] : []
          }
          sourceCollection={
            editor.row
              ? collections.find(
                  (collection) =>
                    collection.id === editor.row?.collectionId ||
                    collection.slug === editor.row?.slug,
                ) ?? null
              : null
          }
          onClose={closeEditor}
          onSave={applyDemoSave}
        />
      ) : null}

      {assignmentOpen ? (
        <ProductAssignmentDraft
          products={products}
          rows={rows}
          onClose={() => setAssignmentOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface UnifiedGroupEditorProps {
  row: UnifiedGroupRow | null;
  initialParentId?: string;
  categories: AdminCategoryNode[];
  products: AdminProduct[];
  memberIds: string[];
  sourceCollection: AdminCollectionRow | null;
  onClose: () => void;
  onSave: (slug: string | null, memberIds: string[]) => void;
}

function categorySubtreeIds(row: UnifiedGroupRow | null): Set<string> {
  const ids = new Set<string>();
  const visit = (node: UnifiedGroupRow): void => {
    ids.add(node.id);
    for (const child of node.children) visit(child);
  };
  if (row) visit(row);
  return ids;
}

function categoryOptions(
  categories: AdminCategoryNode[],
  exclude: Set<string>,
): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const visit = (nodes: AdminCategoryNode[], depth: number): void => {
    for (const node of nodes) {
      if (exclude.has(node.id)) continue;
      out.push({ id: node.id, label: `${"　".repeat(depth)}${node.name}` });
      visit(node.children, depth + 1);
    }
  };
  visit(categories, 0);
  return out;
}

function UnifiedGroupEditor({
  row,
  initialParentId,
  categories,
  products,
  memberIds,
  sourceCollection,
  onClose,
  onSave,
}: UnifiedGroupEditorProps) {
  const isCategory = row?.kind === "CATEGORY";
  const subtreeIds = useMemo(() => categorySubtreeIds(row), [row]);
  const primaryProducts = useMemo(
    () => (isCategory ? products.filter((product) => subtreeIds.has(product.categoryId)) : []),
    [isCategory, products, subtreeIds],
  );
  const primaryIds = useMemo(
    () => new Set(primaryProducts.map((product) => product.id)),
    [primaryProducts],
  );
  const [localMembers, setLocalMembers] = useState<string[]>(memberIds);
  const [search, setSearch] = useState("");
  const [name, setName] = useState(row?.name ?? "");
  const [slug, setSlug] = useState(row?.slug ?? "");
  const [status, setStatus] = useState(row?.status ?? "ACTIVE");
  const [sortOrder, setSortOrder] = useState(String(row?.sortOrder ?? 0));
  const [parentId, setParentId] = useState(initialParentId ?? row?.parentId ?? "");
  const [type, setType] = useState<string>(
    initialParentId ? "CATEGORY" : row?.kind ?? "CATEGORY",
  );
  const [section, setSection] = useState<"basic" | "banner" | "products">("basic");
  const [description, setDescription] = useState(sourceCollection?.description ?? "");
  const [seoTitle, setSeoTitle] = useState(sourceCollection?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(sourceCollection?.seoDescription ?? "");
  const [hero, setHero] = useState<HeroStyleFormValue>(() =>
    toHeroStyleFormValue(sourceCollection?.heroStyle),
  );

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const visibleMemberIds = useMemo(
    () => localMembers.filter((id) => !primaryIds.has(id)),
    [localMembers, primaryIds],
  );
  const memberProducts = useMemo(
    () =>
      visibleMemberIds
        .map((id) => productById.get(id))
        .filter((product): product is AdminProduct => Boolean(product)),
    [visibleMemberIds, productById],
  );
  const effectiveProducts = useMemo(
    () => [...primaryProducts, ...memberProducts],
    [primaryProducts, memberProducts],
  );
  const effectiveIds = useMemo(
    () => new Set(effectiveProducts.map((product) => product.id)),
    [effectiveProducts],
  );
  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) =>
      query
        ? product.name.toLowerCase().includes(query) ||
          product.slug.toLowerCase().includes(query)
        : true,
    );
  }, [products, search]);

  const moveMember = (productId: string, delta: number) => {
    const index = visibleMemberIds.indexOf(productId);
    const targetId = visibleMemberIds[index + delta];
    if (!targetId) return;
    setLocalMembers((prev) => {
      const next = [...prev];
      const from = next.indexOf(productId);
      const to = next.indexOf(targetId);
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  const parentOptions = categoryOptions(
    categories,
    isCategory ? subtreeIds : new Set(),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        row
          ? `编辑分组：${row.name}`
          : initialParentId
            ? "新建子分组（演示）"
            : "新建分组（演示）"
      }
      width="lg"
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="编辑分组分区">
          {(
            [
              ["basic", "基本信息"],
              ["banner", "页面横幅"],
              ["products", "商品名单"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={section === key}
              onClick={() => setSection(key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                section === key
                  ? "bg-cta text-white"
                  : "border border-border bg-card text-ink-secondary hover:text-cta"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {section === "basic" ? (
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="名称" htmlFor="draft-group-name" hint="前台显示与列表名称。">
            <TextInput
              id="draft-group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Slug" htmlFor="draft-group-slug" hint="前台 URL 的最后一段。">
            <TextInput
              id="draft-group-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </Field>
          <Field label="状态" htmlFor="draft-group-status">
            <Select
              id="draft-group-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as "ACTIVE" | "DISABLED")}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="DISABLED">DISABLED</option>
            </Select>
          </Field>
          <Field label="排序" htmlFor="draft-group-sort" hint="数字越小越靠前。">
            <TextInput
              id="draft-group-sort"
              value={sortOrder}
              inputMode="numeric"
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </Field>
          <Field label="类型" htmlFor="draft-group-type" hint="创建后不可改；系统分组不可手工创建。">
            {row ? (
              <p className="rounded-lg border border-border bg-primary-light/30 px-3 py-2 text-sm text-ink-secondary">
                {GROUP_KIND_LABELS[row.kind]}
              </p>
            ) : (
              <Select
                id="draft-group-type"
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                <option value="CATEGORY">商品分类</option>
                <option value="MARKETING">营销集合</option>
                <option value="SCENARIO">场景集合</option>
                <option value="NAVIGATION">导航集合</option>
              </Select>
            )}
          </Field>
          {isCategory || (!row && type === "CATEGORY") ? (
            <Field label="父分组" htmlFor="draft-group-parent" hint="不选就是一级分类。">
              <Select
                id="draft-group-parent"
                value={parentId ?? ""}
                onChange={(event) => setParentId(event.target.value)}
              >
                <option value="">（无，一级分组）</option>
                {parentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="sm:col-span-2">
            <Field
              label="描述"
              htmlFor="draft-group-desc"
              hint="选填。显示在分组页横幅下方的一行说明。"
            >
              <TextInput
                id="draft-group-desc"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </div>
          <Field label="SEO 标题" htmlFor="draft-group-seo-title" hint="选填。留空用分组名。">
            <TextInput
              id="draft-group-seo-title"
              value={seoTitle}
              onChange={(event) => setSeoTitle(event.target.value)}
            />
          </Field>
          <Field label="SEO 描述" htmlFor="draft-group-seo-desc" hint="选填。">
            <TextInput
              id="draft-group-seo-desc"
              value={seoDescription}
              onChange={(event) => setSeoDescription(event.target.value)}
            />
          </Field>
        </section>
        ) : null}

        {section === "banner" ? (
          <section className="flex flex-col gap-4">
            <HeroStyleFields
              idPrefix="draft-group-hero"
              value={hero}
              onChange={(patch) => setHero((prev) => ({ ...prev, ...patch }))}
            />
            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-ink">预览</h3>
              <div className="mt-3">
                <LivePreview>
                  <HeroBanner
                    name={name || row?.name || "分组名称"}
                    style={heroStyleFromForm(hero)}
                    fallbackImage={sourceCollection?.heroImage ?? null}
                  />
                </LivePreview>
              </div>
              {row ? (
                <div className="mt-4 border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-ink-secondary">
                    整页预览（已保存版本）
                  </h4>
                  <div className="mt-3">
                    <StorefrontPreview
                      path={
                        row.kind === "CATEGORY"
                          ? `/categories/${row.slug}`
                          : `/collections/${row.slug}`
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {section === "products" ? (
        <section className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">
              商品名单（共 {effectiveProducts.length} 个：主分组 {primaryProducts.length} 个，成员 {visibleMemberIds.length} 个）
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              顺序即前台展示顺序；用 ↑/↓ 调整成员，用「移除」移出（不会删除商品）。商品分类的主分组商品自动显示，不可在此移除；保存不会修改商品主分组。
            </p>
          </div>

          {isCategory && row ? (
            <div className="rounded-lg border border-border bg-primary-light/20 px-3 py-2">
              <p className="text-xs font-semibold text-ink">子分类商品数</p>
              <ul className="mt-1 space-y-1 text-xs text-ink-secondary">
                {row.children.length === 0 ? (
                  <li>没有子分类；本级：{countText(row.counts)}（{detailText(row.counts)}）</li>
                ) : (
                  row.children.map((child) => (
                    <li key={child.id}>
                      {child.name}：{countText(child.counts)}（{detailText(child.counts)}）
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

          <ul
            aria-label="商品名单"
            className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm"
          >
            {effectiveProducts.length === 0 ? (
              <li className="px-3 py-4 text-xs text-ink-muted">名单为空。</li>
            ) : (
              effectiveProducts.map((product) => {
                const isPrimary = primaryIds.has(product.id);
                const memberIndex = visibleMemberIds.indexOf(product.id);
                const skuCodes = skuCodesFor(product);
                return (
                  <li key={product.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="w-6 shrink-0 text-xs text-ink-muted">
                      {isPrimary ? "" : memberIndex + 1}
                    </span>
                    <ProductThumb product={product} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{product.name}</span>
                      {skuCodes.length > 0 ? (
                        <span
                          className="block truncate text-xs text-ink-muted"
                          title={skuCodes.join(", ")}
                        >
                          {skuCodes.join(", ")}
                        </span>
                      ) : null}
                    </span>
                    <Badge
                      value={product.status}
                      tone={product.status === "ACTIVE" ? "green" : undefined}
                    />
                    {isPrimary ? (
                      <span className="rounded-full bg-primary-light/60 px-2 py-0.5 text-xs font-semibold text-cta">
                        主分组
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label={`上移 ${product.name}`}
                          disabled={memberIndex === 0}
                          onClick={() => moveMember(product.id, -1)}
                          className="rounded px-1.5 py-0.5 text-xs text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`下移 ${product.name}`}
                          disabled={memberIndex === visibleMemberIds.length - 1}
                          onClick={() => moveMember(product.id, 1)}
                          className="rounded px-1.5 py-0.5 text-xs text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setLocalMembers((prev) => prev.filter((id) => id !== product.id))
                          }
                          className="rounded px-2 py-1 text-xs font-semibold text-admin-error hover:bg-red-50"
                        >
                          移除
                        </button>
                      </>
                    )}
                  </li>
                );
              })
            )}
          </ul>

          <div className="rounded-lg border border-dashed border-border px-3 py-2">
            <p className="text-xs font-semibold text-ink">添加商品（成员）</p>
            <div className="mt-1 flex gap-2">
              <TextInput
                aria-label="搜索候选商品"
                type="search"
                placeholder="按商品名或 slug 搜索"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
              {candidates.length === 0 ? (
                <p className="px-3 py-4 text-xs text-ink-muted">
                  没有找到商品{search.trim() ? `：${search.trim()}` : ""}。
                </p>
              ) : (
                <ul aria-label="候选商品" className="divide-y divide-border text-sm">
                  {candidates.map((product) => {
                    const inList = effectiveIds.has(product.id);
                    const skuCodes = skuCodesFor(product);
                    return (
                      <li key={product.id} className="flex items-center gap-2 px-3 py-2">
                        <ProductThumb product={product} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ink">{product.name}</span>
                          <span
                            className="block truncate text-xs text-ink-muted"
                            title={skuCodes.length > 0 ? skuCodes.join(", ") : undefined}
                          >
                            {skuCodes.length > 0 ? skuCodes.join(", ") : "—"}
                          </span>
                        </span>
                        <Badge
                          value={product.status}
                          tone={product.status === "ACTIVE" ? "green" : undefined}
                        />
                        {inList ? (
                          <span className="w-16 shrink-0 text-right text-xs text-ink-muted">
                            已在名单
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setLocalMembers((prev) =>
                                prev.includes(product.id) ? prev : [...prev, product.id],
                              )
                            }
                            className="w-16 shrink-0 rounded px-2 py-1 text-xs font-semibold text-cta hover:bg-primary-light/40"
                          >
                            添加
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {candidates.length > 0 ? (
              <p className="mt-1 text-xs text-ink-muted">共 {candidates.length} 个商品</p>
            ) : null}
            <p className="mt-1 text-xs text-ink-muted">
              草稿/下架商品可以加入名单，但要等商品 ACTIVE 后才会在前台集合页出现。
            </p>
          </div>
        </section>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            关闭
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => onSave(row?.slug ?? null, localMembers)}
          >
            保存（演示）
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ProductAssignmentDraft({
  products,
  rows,
  onClose,
}: {
  products: AdminProduct[];
  rows: UnifiedGroupRow[];
  onClose: () => void;
}) {
  const categoryRows = rows.filter((row) => row.kind === "CATEGORY");
  const otherRows = rows.filter((row) => row.kind !== "CATEGORY");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const product = products.find((entry) => entry.id === productId) ?? products[0] ?? null;
  const [primaryId, setPrimaryId] = useState(product?.categoryId ?? "");
  const [others, setOthers] = useState<Set<string>>(new Set());
  const productSkuCodes = product ? skuCodesFor(product) : [];

  const primaryOptions = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const visit = (nodes: UnifiedGroupRow[], depth: number): void => {
      for (const node of nodes) {
        out.push({ id: node.id, label: `${"　".repeat(depth)}${node.name}` });
        visit(node.children, depth + 1);
      }
    };
    visit(categoryRows, 0);
    return out;
  }, [categoryRows]);

  const otherChoices = useMemo(() => {
    const out: { row: UnifiedGroupRow; depth: number }[] = [];
    const visit = (nodes: UnifiedGroupRow[], depth: number): void => {
      for (const node of nodes) {
        out.push({ row: node, depth });
        visit(node.children, depth + 1);
      }
    };
    visit(categoryRows, 0);
    for (const row of otherRows) out.push({ row, depth: 0 });
    return out;
  }, [categoryRows, otherRows]);

  return (
    <Dialog open onClose={onClose} title="商品归属交互稿（演示）" width="md">
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-ink-secondary">
          商品编辑页最终同时管理主分组与其他分组；这里演示交互，不写数据库。
        </p>
        <Field label="商品" htmlFor="draft-assignment-product">
          <Select
            id="draft-assignment-product"
            value={productId}
            onChange={(event) => {
              const next = event.target.value;
              setProductId(next);
              const entry = products.find((item) => item.id === next);
              setPrimaryId(entry?.categoryId ?? "");
              setOthers(new Set());
            }}
          >
            {products.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
        </Field>
        {product ? (
          <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
            <ProductThumb product={product} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{product.name}</span>
              <span
                className="block truncate text-xs text-ink-muted"
                title={productSkuCodes.length > 0 ? productSkuCodes.join(", ") : undefined}
              >
                {productSkuCodes.length > 0 ? productSkuCodes.join(", ") : "无 SKU"}
              </span>
            </span>
            <Badge
              value={product.status}
              tone={product.status === "ACTIVE" ? "green" : undefined}
            />
          </div>
        ) : null}
        <Field label="主分组（单选）" htmlFor="draft-assignment-primary" hint="决定面包屑与分类归属。">
          <Select
            id="draft-assignment-primary"
            value={primaryId}
            onChange={(event) => setPrimaryId(event.target.value)}
          >
            {primaryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">其他分组（多选）</p>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border px-3 py-2 text-sm">
            {otherChoices
              .filter(({ row }) => row.id !== primaryId)
              .map(({ row, depth }) => (
                <label
                  key={row.id}
                  className="flex items-center gap-2 text-ink-secondary"
                  style={{ paddingLeft: depth * 16 }}
                >
                  <input
                    type="checkbox"
                    checked={others.has(row.id)}
                    onChange={(event) => {
                      setOthers((prev) => {
                        const next = new Set(prev);
                        if (event.target.checked) next.add(row.id);
                        else next.delete(row.id);
                        return next;
                      });
                    }}
                  />
                  {row.name}
                  <span className="text-xs text-ink-muted">（{GROUP_KIND_LABELS[row.kind]}）</span>
                </label>
              ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            关闭
          </Button>
          <Button type="button" variant="primary" size="md" onClick={onClose}>
            保存（演示）
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
