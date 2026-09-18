"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Badge } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import { Field } from "@/components/admin/Field";
import {
  HeroStyleFields,
  heroStyleFromForm,
  serializeHeroStyle,
  toHeroStyleFormValue,
  type HeroStyleFormValue,
} from "@/components/admin/HeroStyleFields";
import { LivePreview, StorefrontPreview } from "@/components/admin/PreviewPane";
import { HeroBanner } from "@/components/product/HeroBanner";
import { EmptyState } from "@/components/admin/EmptyState";
import { Select, TextInput } from "@/components/admin/Field";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  type AdminCollectionRow,
  type AdminProduct,
  type Paged,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
import { api, type Product } from "@/lib/api";

// Badge source collections (storefront PLP reads membership of these slugs).
const NEW_BADGE_SLUG = "new-arrivals";
const BESTSELLER_BADGE_SLUG = "best-sellers";

const TYPE_HINTS: Record<AdminCollectionRow["type"], string> = {
  NAVIGATION: "导航集合（分类导购页）",
  MARKETING: "营销集合（活动/角标）",
  SCENARIO: "场景集合（按使用场景组货）",
  SYSTEM: "系统集合（前台功能依赖，勿随意改名）",
};

interface MemberItem {
  id: string;
  name: string;
  slug: string;
}

/** Basic-info form shared by the unified page editor. */
interface EditorForm {
  name: string;
  slug: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  status: "ACTIVE" | "DISABLED";
  sortOrder: string;
}

async function fetchAllMembers(slug: string): Promise<MemberItem[]> {
  // The admin list returns only _count; the public storefront endpoint is the
  // only membership read in V1 (ACTIVE products, membership order). Page
  // through it using the server-reported page size.
  const out: MemberItem[] = [];
  let page = 1;
  for (;;) {
    const res: Paged<Product> = await api.getCollectionProducts(slug, page);
    for (const p of res.items) {
      out.push({ id: p.id, name: p.name, slug: p.slug });
    }
    if (out.length >= res.total || res.items.length === 0) break;
    page += 1;
  }
  return out;
}

function badgeRoleFor(slug: string): string | null {
  if (slug === NEW_BADGE_SLUG) {
    return "前台商品卡「New」角标来源：新品上架后加入此集合。";
  }
  if (slug === BESTSELLER_BADGE_SLUG) {
    return "前台商品卡「Bestseller」角标来源：只放真实热销款，新品不要挂。";
  }
  return null;
}

function CollectionsPageContent() {
  const { hasPermission } = useAdminAuth();
  const canManage = hasPermission("PRODUCT_MANAGE");

  const [rows, setRows] = useState<AdminCollectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setRows(null);
    setError(null);
    setPermissionDenied(false);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    adminApi
      .listCollections()
      .then((res) => {
        if (!active) return;
        setRows(res.items);
        setError(null);
        setPermissionDenied(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPermissionDenied(errorStatus(err) === 403);
        setError(err instanceof Error ? err.message : "Failed to load collections.");
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  // --- unified page editor (basic info + banner + membership) ---------------

  const [editor, setEditor] = useState<{
    collection: AdminCollectionRow;
    form: EditorForm;
    hero: HeroStyleFormValue;
  } | null>(null);
  const [editorPending, setEditorPending] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorSaved, setEditorSaved] = useState<string | null>(null);
  const [editorSection, setEditorSection] = useState<"basic" | "banner" | "products">("basic");

  // membership editor state (was its own dialog; now a section of the editor)
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersLoadError, setMembersLoadError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<AdminProduct[] | null>(null);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCandidates = useCallback((search: string) => {
    setCandidatesLoading(true);
    adminApi
      .listProducts({ search: search || undefined, page: 1, pageSize: 20 })
      .then((res) => {
        if (!mountedRef.current) return;
        setCandidates(res.items);
        setCandidateTotal(res.total);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setCandidates([]);
        setCandidateTotal(0);
      })
      .finally(() => {
        if (mountedRef.current) setCandidatesLoading(false);
      });
  }, []);


  const openEditor = useCallback((collection: AdminCollectionRow) => {
    setEditor({
      collection,
      form: {
        name: collection.name,
        slug: collection.slug,
        description: collection.description ?? "",
        seoTitle: collection.seoTitle ?? "",
        seoDescription: collection.seoDescription ?? "",
        status: collection.status,
        sortOrder: String(collection.sortOrder),
      },
      hero: toHeroStyleFormValue(collection.heroStyle),
    });
    setEditorSection("basic");
    setEditorPending(false);
    setEditorError(null);
    setEditorSaved(null);

    // Membership loads alongside (section 3).
    setMembers([]);
    setMembersLoading(true);
    setMembersLoadError(null);
    setSearchInput("");
    setAppliedSearch("");
    setCandidates(null);
    fetchAllMembers(collection.slug)
      .then((items) => {
        if (!mountedRef.current) return;
        setMembers(items);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        // A disabled collection is not readable via the public endpoint.
        // Block the membership save: PATCH replaces the whole list, and saving
        // a list we could not load would silently wipe existing members.
        setMembersLoadError(
          "无法读取当前商品名单（集合可能处于 DISABLED 停用状态）。请先启用集合后再管理，以免保存时清空原有商品。",
        );
      })
      .finally(() => {
        if (mountedRef.current) setMembersLoading(false);
      });
    loadCandidates("");
  }, [loadCandidates]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  const closeEditor = useCallback(() => {
    if (editorPending) return;
    setEditor(null);
  }, [editorPending]);

  const addMember = useCallback((product: AdminProduct) => {
    setMembers((prev) =>
      prev.some((m) => m.id === product.id)
        ? prev
        : [...prev, { id: product.id, name: product.name, slug: product.slug }],
    );
  }, []);

  const removeMember = useCallback((id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const moveMember = useCallback((index: number, delta: -1 | 1) => {
    setMembers((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const submitSearch = useCallback(() => {
    const value = searchInput.trim();
    setAppliedSearch(value);
    loadCandidates(value);
  }, [searchInput, loadCandidates]);

  /**
   * One save for the whole editor: basic info + banner in one PATCH, then the
   * membership replacement (skipped with a notice when it failed to load).
   */
  const saveEditor = useCallback(async () => {
    if (!editor || editorPending) return;
    const heroResult = serializeHeroStyle(editor.hero);
    if (!heroResult.ok) {
      setEditorError(heroResult.error);
      setEditorSection("banner");
      return;
    }
    const f = editor.form;
    if (!f.name.trim()) {
      setEditorError("名称必填。");
      setEditorSection("basic");
      return;
    }
    setEditorPending(true);
    setEditorError(null);
    setEditorSaved(null);
    try {
      await adminApi.updateCollection(editor.collection.id, {
        name: f.name.trim(),
        slug: f.slug.trim(),
        description: f.description.trim() || null,
        seoTitle: f.seoTitle.trim() || null,
        seoDescription: f.seoDescription.trim() || null,
        status: f.status,
        sortOrder: Number(f.sortOrder || "0"),
        heroStyle: heroResult.value,
      });
      if (!mountedRef.current) return;

      let memberNote = "";
      if (membersLoadError) {
        memberNote = "（商品名单未能读取，本次未改动名单）";
      } else if (!membersLoading) {
        await adminApi.setCollectionProducts(
          editor.collection.id,
          members.map((m) => m.id),
        );
        if (!mountedRef.current) return;
      }
      setEditorSaved(`已保存。${memberNote}`);

      // Reflect edits in the table immediately.
      setRows((prev) =>
        prev
          ? prev.map((row) =>
              row.id === editor.collection.id
                ? {
                    ...row,
                    name: f.name.trim(),
                    slug: f.slug.trim(),
                    description: f.description.trim() || null,
                    status: f.status,
                    sortOrder: Number(f.sortOrder || "0"),
                    heroStyle: editor.collection.heroStyle
                      ? { ...editor.collection.heroStyle, ...heroStyleFromForm(editor.hero) }
                      : (heroStyleFromForm(editor.hero) as AdminCollectionRow["heroStyle"]),
                    _count:
                      membersLoadError || membersLoading
                        ? row._count
                        : { products: members.length },
                  }
                : row,
            )
          : prev,
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setEditorError(err instanceof Error ? err.message : "保存失败，请重试。");
    } finally {
      if (mountedRef.current) setEditorPending(false);
    }
  }, [editor, editorPending, members, membersLoading, membersLoadError]);

  return (
    <div>

      {/* Chinese operator guide */}
      <div className="rounded-xl border border-primary/50 bg-primary-light/30 p-4 text-xs leading-relaxed text-ink-secondary">
        <p className="text-sm font-semibold text-ink">集合（Collections）是什么</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            集合是<span className="font-semibold">营销分组</span>，一个商品可以同时加入多个集合；它不影响商品的固定归属分类（Category，每个商品只能选一个，在 Products
            表单里设置）。
          </li>
          <li>
            集合内商品的<span className="font-semibold">排列顺序就是前台展示顺序</span>，第 1
            个排在最前；可用 ↑ / ↓ 调整。
          </li>
          <li>
            <span className="font-semibold">New Arrivals</span> 控制商品卡的
            <span className="font-semibold"> New </span>角标，新品上架后加入；
            <span className="font-semibold"> Best Sellers</span> 控制
            <span className="font-semibold"> Bestseller </span>角标，只放真实出单的热销款，新品不要挂。
          </li>
          <li>
            点 <span className="font-semibold">编辑</span>：一个弹窗里改完基本信息、页面横幅和商品名单，一次保存。
          </li>
        </ul>
        <p className="mt-2 text-ink-muted">
          注意：名单只读取在售（ACTIVE）商品。若集合中含有草稿/下架商品，它们不会显示在名单里，保存时会被一并移出，请在商品全部在售时操作。
        </p>
      </div>

      <div className="mt-4">
        {rows === null ? (
          <TableSkeleton rows={7} cols={6} />
        ) : permissionDenied ? (
          <EmptyState
            title="你没有访问 Collections 的权限。"
            hint="需要商品管理（PRODUCT_MANAGE）权限，请联系超级管理员开通。"
          />
        ) : error ? (
          <div role="alert" className="rounded-xl border border-border bg-card p-6">
            <p className="text-sm font-semibold text-ink">集合加载失败。</p>
            <p className="mt-1 text-sm text-ink-muted">{error}</p>
            <Button variant="secondary" size="md" onClick={reload} className="mt-4">
              重试
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="暂无集合。" hint="系统初始化的集合缺失，请联系开发人员。" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">Collections</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-4 py-3">Collection</th>
                  <th scope="col" className="px-4 py-3">类型</th>
                  <th scope="col" className="px-4 py-3">状态</th>
                  <th scope="col" className="px-4 py-3">商品数</th>
                  <th scope="col" className="px-4 py-3">排序</th>
                  <th scope="col" className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const role = badgeRoleFor(row.slug);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-ink">{row.name}</div>
                        <div className="font-mono text-xs text-ink-muted">
                          /collections/{row.slug}
                        </div>
                        {role ? (
                          <div className="mt-0.5 text-xs text-primary">{role}</div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-secondary">
                        {TYPE_HINTS[row.type]}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          value={row.status}
                          tone={row.status === "ACTIVE" ? "green" : "red"}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">
                        {row._count.products}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                        {row.sortOrder}
                      </td>
                      <td className="px-4 py-3">
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => openEditor(row)}
                            className="text-sm font-semibold text-cta hover:underline"
                          >
                            编辑
                          </button>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Unified page editor: basic info + banner + membership, one save */}
      <Dialog
        open={editor !== null}
        onClose={closeEditor}
        title={editor ? `编辑集合：${editor.collection.name}` : "编辑集合"}
        width="lg"
      >
        {editor ? (
          <div className="flex flex-col gap-6">
            {/* Section nav */}
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="编辑集合分区">
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
                  aria-selected={editorSection === key}
                  onClick={() => setEditorSection(key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    editorSection === key
                      ? "bg-cta text-white"
                      : "border border-border bg-card text-ink-secondary hover:text-cta"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {editorSection === "basic" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="名称 *" htmlFor="col-name" hint="前台集合页标题与首页区块名。">
                  <TextInput
                    id="col-name"
                    value={editor.form.name}
                    onChange={(e) =>
                      setEditor((prev) =>
                        prev ? { ...prev, form: { ...prev.form, name: e.target.value } } : prev,
                      )
                    }
                    disabled={editorPending}
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label="Slug *"
                  htmlFor="col-slug"
                  hint="前台网址 /collections/ 后面那段。改动后旧链接失效，谨慎修改。"
                >
                  <TextInput
                    id="col-slug"
                    value={editor.form.slug}
                    onChange={(e) =>
                      setEditor((prev) =>
                        prev ? { ...prev, form: { ...prev.form, slug: e.target.value } } : prev,
                      )
                    }
                    disabled={editorPending}
                    autoComplete="off"
                  />
                </Field>
                <Field label="状态" htmlFor="col-status" hint="DISABLED 时前台整页与名单接口都不可读。">
                  <Select
                    id="col-status"
                    value={editor.form.status}
                    onChange={(e) =>
                      setEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: { ...prev.form, status: e.target.value as "ACTIVE" | "DISABLED" },
                            }
                          : prev,
                      )
                    }
                    disabled={editorPending}
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DISABLED">DISABLED</option>
                  </Select>
                </Field>
                <Field label="排序" htmlFor="col-sort" hint="数字越小越靠前（同类型集合列表）。">
                  <TextInput
                    id="col-sort"
                    inputMode="numeric"
                    value={editor.form.sortOrder}
                    onChange={(e) =>
                      setEditor((prev) =>
                        prev ? { ...prev, form: { ...prev.form, sortOrder: e.target.value } } : prev,
                      )
                    }
                    disabled={editorPending}
                    autoComplete="off"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field
                    label="描述"
                    htmlFor="col-desc"
                    hint="选填。显示在集合页横幅下方的一行说明。"
                  >
                    <TextInput
                      id="col-desc"
                      value={editor.form.description}
                      onChange={(e) =>
                        setEditor((prev) =>
                          prev
                            ? { ...prev, form: { ...prev.form, description: e.target.value } }
                            : prev,
                        )
                      }
                      disabled={editorPending}
                      autoComplete="off"
                    />
                  </Field>
                </div>
                <Field label="SEO 标题" htmlFor="col-seo-title" hint="选填。留空用集合名。">
                  <TextInput
                    id="col-seo-title"
                    value={editor.form.seoTitle}
                    onChange={(e) =>
                      setEditor((prev) =>
                        prev
                          ? { ...prev, form: { ...prev.form, seoTitle: e.target.value } }
                          : prev,
                      )
                    }
                    disabled={editorPending}
                    autoComplete="off"
                  />
                </Field>
                <Field label="SEO 描述" htmlFor="col-seo-desc" hint="选填。">
                  <TextInput
                    id="col-seo-desc"
                    value={editor.form.seoDescription}
                    onChange={(e) =>
                      setEditor((prev) =>
                        prev
                          ? { ...prev, form: { ...prev.form, seoDescription: e.target.value } }
                          : prev,
                      )
                    }
                    disabled={editorPending}
                    autoComplete="off"
                  />
                </Field>
              </div>
            ) : null}

            {editorSection === "banner" ? (
              <div className="flex flex-col gap-4">
                <HeroStyleFields
                  idPrefix="col-hero"
                  value={editor.hero}
                  onChange={(patch) =>
                    setEditor((prev) =>
                      prev ? { ...prev, hero: { ...prev.hero, ...patch } } : prev,
                    )
                  }
                  disabled={editorPending}
                />
                <div className="border-t border-border pt-4">
                  <h3 className="text-sm font-semibold text-ink">预览</h3>
                  <div className="mt-3 flex flex-col gap-5">
                    <LivePreview>
                      <HeroBanner
                        name={editor.form.name || editor.collection.name}
                        style={heroStyleFromForm(editor.hero)}
                        fallbackImage={editor.collection.heroImage}
                      />
                    </LivePreview>
                    <div className="border-t border-border pt-4">
                      <h4 className="text-xs font-semibold text-ink-secondary">
                        整页预览（已保存版本）
                      </h4>
                      <div className="mt-3">
                        <StorefrontPreview
                          path={`/collections/${editor.collection.slug}`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {editorSection === "products" ? (
              <div className="flex flex-col gap-5">
                {membersLoadError ? (
                  <p
                    role="alert"
                    className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800"
                  >
                    {membersLoadError}
                  </p>
                ) : null}

                {/* Current membership, in display order */}
                <section>
                  <p className="text-sm font-semibold text-ink">
                    当前名单（{membersLoading ? "读取中…" : `${members.length} 个`}）
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    顺序即前台展示顺序；用 ↑/↓ 调整，用「移除」移出集合（不会删除商品本身）。
                  </p>
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
                    {membersLoading ? (
                      <p className="px-3 py-4 text-xs text-ink-muted">
                        正在读取当前商品名单…
                      </p>
                    ) : members.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-ink-muted">
                        集合为空。从下方搜索结果中添加商品。
                      </p>
                    ) : (
                      <ul className="divide-y divide-border text-sm">
                        {members.map((m, index) => (
                          <li
                            key={m.id}
                            className="flex items-center gap-2 px-3 py-2"
                          >
                            <span className="w-6 shrink-0 text-xs text-ink-muted">
                              {index + 1}
                            </span>
                            <span className="flex-1 truncate text-ink">{m.name}</span>
                            <button
                              type="button"
                              aria-label={`上移 ${m.name}`}
                              disabled={index === 0 || editorPending}
                              onClick={() => moveMember(index, -1)}
                              className="rounded px-1.5 py-0.5 text-xs text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label={`下移 ${m.name}`}
                              disabled={index === members.length - 1 || editorPending}
                              onClick={() => moveMember(index, 1)}
                              className="rounded px-1.5 py-0.5 text-xs text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              disabled={editorPending}
                              onClick={() => removeMember(m.id)}
                              className="rounded px-1.5 py-0.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-ink-muted"
                            >
                              移除
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                {/* Add products */}
                <section>
                  <p className="text-sm font-semibold text-ink">添加商品</p>

                  <div className="mt-2 flex gap-2">
                    <div className="flex-1">
                      <TextInput
                        id="collection-product-search"
                        aria-label="搜索商品"
                        type="search"
                        placeholder="按商品名搜索（英文名称）"
                        value={searchInput}
                        disabled={!!membersLoadError}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            submitSearch();
                          }
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      disabled={!!membersLoadError}
                      onClick={submitSearch}
                    >
                      搜索
                    </Button>
                  </div>
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
                    {candidatesLoading ? (
                      <p className="px-3 py-4 text-xs text-ink-muted">搜索中…</p>
                    ) : candidates === null ? null : candidates.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-ink-muted">
                        没有找到商品{appliedSearch ? `：${appliedSearch}` : ""}。
                      </p>
                    ) : (
                      <ul className="divide-y divide-border text-sm">
                        {candidates.map((p) => {
                          const inCollection = memberIds.has(p.id);
                          return (
                            <li
                              key={p.id}
                              className="flex items-center gap-2 px-3 py-2"
                            >
                              <span className="flex-1 truncate text-ink">
                                {p.name}
                              </span>
                              <Badge
                                value={p.status}
                                tone={p.status === "ACTIVE" ? "green" : undefined}
                              />
                              {inCollection ? (
                                <span className="w-16 text-right text-xs text-ink-muted">
                                  已在名单
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={editorPending || !!membersLoadError}
                                  onClick={() => addMember(p)}
                                  className="w-16 rounded px-2 py-1 text-xs font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted"
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
                  {candidateTotal > 20 ? (
                    <p className="mt-1 text-xs text-ink-muted">
                      共 {candidateTotal} 个结果，仅显示前 20 个；请输入更精确的商品名再搜索。
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-muted">
                    草稿/下架商品可以加入名单，但要等商品 ACTIVE 后才会在前台集合页出现。
                  </p>
                </section>
              </div>
            ) : null}

            {editorError ? (
              <p
                role="alert"
                className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800"
              >
                {editorError}
              </p>
            ) : null}
            {editorSaved ? (
              <p
                role="status"
                className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-800"
              >
                {editorSaved}
              </p>
            ) : null}

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={closeEditor}
                disabled={editorPending}
              >
                关闭
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={saveEditor}
                disabled={editorPending}
                aria-busy={editorPending}
              >
                {editorPending ? "保存中…" : "保存全部"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

export function CollectionsPanel() {
  return <CollectionsPageContent />;
}
