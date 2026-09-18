"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Badge } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import {
  HeroStyleFields,
  emptyHeroStyleFormValue,
  heroStyleFromForm,
  serializeHeroStyle,
  toHeroStyleFormValue,
  type HeroStyleFormValue,
} from "@/components/admin/HeroStyleFields";
import { LivePreview, StorefrontPreview } from "@/components/admin/PreviewPane";
import { HeroBanner } from "@/components/product/HeroBanner";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  type AdminCategoryNode,
  type CreateCategoryInput,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

// --- constants mirroring backend category.dto.ts ----------------------------
// name: z.string().min(1).max(120); slug: min(1).max(120) kebab-case;
// imageUrl: z.string().url().max(2048).nullable(); sortOrder: z.number().int().
const NAME_MAX = 120;
const SLUG_MAX = 120;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_HINT =
  "slug must be lowercase kebab-case (e.g. folding-chair)";
// Backend 409 body (Prisma P2002); rendered with a trailing period.
const SLUG_CONFLICT = "A category with this slug already exists.";
// CategoriesService.update() maps parentId null -> undefined, so moving a
// child back to root silently no-ops (PATCH 200, relationship unchanged).
// The UI must not offer that action.
const ROOT_MOVE_HINT =
  "Moving a category back to the root is not supported in this build.";
// Required nonnegative whole number (client posture mirrors ProductForm).
const SORT_RE = /^\d+$/;

type CategoryStatus = "ACTIVE" | "DISABLED";
type FlatRow = { node: AdminCategoryNode; depth: number };
type FieldErrors = Record<string, string>;

// Stable display order: sortOrder asc, then name asc (the API already orders
// this way; this only guarantees the requirement).
function sortTree(nodes: AdminCategoryNode[]): AdminCategoryNode[] {
  return [...nodes]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((node) =>
      node.children.length > 0
        ? { ...node, children: sortTree(node.children) }
        : node,
    );
}

// Depth-first flatten for the table rows and the parent <select> options.
function flattenTree(
  nodes: AdminCategoryNode[],
  depth = 0,
  acc: FlatRow[] = [],
): FlatRow[] {
  for (const node of nodes) {
    acc.push({ node, depth });
    if (node.children.length > 0) flattenTree(node.children, depth + 1, acc);
  }
  return acc;
}

// Finds a node anywhere in the forest (DFS).
function findNode(
  nodes: AdminCategoryNode[],
  id: string,
): AdminCategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findNode(node.children, id);
    if (hit) return hit;
  }
  return null;
}

// Collects the node's own id plus every descendant id (DFS).
function collectSubtreeIds(node: AdminCategoryNode, acc: Set<string>): void {
  acc.add(node.id);
  for (const child of node.children) collectSubtreeIds(child, acc);
}

// New forest with one node (and its subtree) removed — optimistic delete.
function removeNode(
  nodes: AdminCategoryNode[],
  id: string,
): AdminCategoryNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) =>
      node.children.length > 0
        ? { ...node, children: removeNode(node.children, id) }
        : node,
    );
}

function emptyForm(
  mode: "create" | "edit",
  presetParentId = "",
): CategoryForm {
  return {
    mode,
    id: null,
    originalParentId: null,
    name: "",
    slug: "",
    parentId: presetParentId,
    sortOrder: "0",
    status: "ACTIVE",
    heroStyle: emptyHeroStyleFormValue(),
  };
}

type CategoryForm = {
  mode: "create" | "edit";
  id: string | null;
  // Parent at dialog-open time (null for roots and for create mode); drives
  // the disabled "None (root)" option and the root-move submit guard.
  originalParentId: string | null;
  name: string;
  slug: string;
  parentId: string;
  sortOrder: string;
  status: CategoryStatus;
  /** Hero appearance for the category landing page (separate HeroStyle row). */
  heroStyle: HeroStyleFormValue;
};

export function CategoriesPanel() {
  const { hasPermission } = useAdminAuth();
  const canManage = hasPermission("PRODUCT_MANAGE");

  // --- tree data ------------------------------------------------------------

  const [tree, setTree] = useState<AdminCategoryNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    adminApi
      .listCategories()
      .then((res) => {
        if (active) {
          setLoadError(null);
          setTree(sortTree(res));
        }
      })
      .catch((err: unknown) => {
        // 403 for roles without PRODUCT_MANAGE lands here verbatim
        // ("Missing required permission") — surface as the page error.
        if (active) {
          setTree(null);
          setLoadError(
            err instanceof Error ? err.message : "Failed to load categories.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const sortedTree = useMemo(() => tree ?? [], [tree]);
  const rows = useMemo(() => flattenTree(sortedTree), [sortedTree]);

  // --- create / edit dialog --------------------------------------------------

  const [form, setForm] = useState<CategoryForm>(emptyForm("create"));
  const [formOpen, setFormOpen] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formPending, setFormPending] = useState(false);

  // Parent options: every category, depth indented. In EDIT mode exclude the
  // edited node's ENTIRE subtree (itself + all descendants). The backend only
  // guards self-parent (400); picking a descendant returns 200 and creates a
  // cycle that buildTree() silently drops from the admin tree and storefront
  // mega menu, so the cycle has to be prevented client-side. CREATE mode
  // excludes nothing.
  const subtreeExcludeIds = useMemo(() => {
    if (form.mode !== "edit" || !form.id) return null;
    const target = findNode(sortedTree, form.id);
    if (!target) return null;
    const ids = new Set<string>();
    collectSubtreeIds(target, ids);
    return ids;
  }, [form.mode, form.id, sortedTree]);

  const parentOptions = useMemo(
    () =>
      rows.filter(
        (row) => !subtreeExcludeIds?.has(row.node.id),
      ),
    [rows, subtreeExcludeIds],
  );

  // A child cannot be moved back to root through this build (the backend maps
  // parentId:null -> undefined on PATCH), so "None (root)" is offered only
  // when creating or when editing an existing root.
  const rootOptionDisabled =
    form.mode === "edit" && form.originalParentId !== null;

  const openCreate = useCallback((presetParentId = "") => {
    setErrors({});
    setFormError(null);
    setForm(emptyForm("create", presetParentId));
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((node: AdminCategoryNode) => {
    setErrors({});
    setFormError(null);
    setForm({
      mode: "edit",
      id: node.id,
      originalParentId: node.parentId,
      name: node.name,
      slug: node.slug,
      parentId: node.parentId ?? "",
      sortOrder: String(node.sortOrder),
      status: node.status,
      heroStyle: toHeroStyleFormValue(node.heroStyle),
    });
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    if (formPending) return;
    setFormOpen(false);
    setErrors({});
    setFormError(null);
  }, [formPending]);

  const patchForm = useCallback(
    (patch: Partial<CategoryForm>) => {
      setForm((prev) => ({ ...prev, ...patch }));
      // Clear-on-edit: any field the user retries immediately drops its
      // validation/server error (e.g. the 409 slug conflict).
      setErrors((prev) => {
        let next: FieldErrors | null = null;
        for (const key of Object.keys(patch)) {
          if (prev[key]) {
            (next ??= { ...prev });
            delete next[key];
          }
        }
        return next ?? prev;
      });
    },
    [],
  );

  const validate = useCallback(
    (value: CategoryForm): CreateCategoryInput | null => {
      const next: FieldErrors = {};

      const name = value.name.trim();
      if (!name) next.name = "Name is required.";
      else if (name.length > NAME_MAX)
        next.name = `Name must be ${NAME_MAX} characters or fewer.`;

      const slug = value.slug.trim();
      if (!slug) next.slug = "Slug is required.";
      else if (slug.length > SLUG_MAX || !SLUG_RE.test(slug))
        next.slug = SLUG_HINT;

      const sortRaw = value.sortOrder.trim();
      let sortOrder = 0;
      if (!sortRaw) next.sortOrder = "Sort order is required.";
      else if (!SORT_RE.test(sortRaw))
        next.sortOrder = "Sort order must be a whole number of 0 or greater.";
      else sortOrder = Number(sortRaw);

      // Hero styling is a separate HeroStyle row; null means "no custom
      // styling", which makes the API clear it rather than store defaults.
      const heroResult = serializeHeroStyle(value.heroStyle);
      const heroStyleValue = heroResult.ok ? heroResult.value : null;
      if (!heroResult.ok) next.heroStyle = heroResult.error;

      setErrors(next);
      if (Object.keys(next).length > 0) return null;

      return {
        name,
        slug,
        parentId: value.parentId || null,
        sortOrder,
        status: value.status,
        heroStyle: heroStyleValue,
      };
    },
    [],
  );

  const submitForm = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const payload = validate(form);
      if (!payload) return;
      // Defensive mirror of the disabled "None (root)" option: the backend
      // PATCH maps parentId:null -> undefined, so the move would 200 while
      // silently doing nothing. Block it instead.
      if (
        form.mode === "edit" &&
        form.originalParentId !== null &&
        !payload.parentId
      ) {
        setErrors((prev) => ({ ...prev, parentId: ROOT_MOVE_HINT }));
        return;
      }
      setFormPending(true);
      setFormError(null);
      try {
        if (form.mode === "edit" && form.id) {
          await adminApi.updateCategory(form.id, payload);
        } else {
          await adminApi.createCategory(payload);
        }
        setFormOpen(false);
        setErrors({});
        setFormError(null);
        setNonce((n) => n + 1);
      } catch (err: unknown) {
        // 409 duplicate slug — attach to the slug field with the exact copy.
        if (errorStatus(err) === 409) {
          setErrors((prev) => ({ ...prev, slug: SLUG_CONFLICT }));
        } else {
          // 400 self-parent / bad parent and anything else: verbatim inline.
          setFormError(
            err instanceof Error ? err.message : "Save failed.",
          );
        }
      } finally {
        setFormPending(false);
      }
    },
    [form, validate],
  );

  // --- delete dialog ---------------------------------------------------------

  const [deleteTarget, setDeleteTarget] = useState<AdminCategoryNode | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const openDelete = useCallback((node: AdminCategoryNode) => {
    setDeleteError(null);
    setDeleteTarget(node);
  }, []);

  const closeDelete = useCallback(() => {
    if (deletePending) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }, [deletePending]);

  const submitDelete = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const target = deleteTarget;
      if (!target) return;
      setDeletePending(true);
      setDeleteError(null);
      // Optimistic: drop the subtree immediately; a blocked delete refetches
      // server truth and restores it.
      setTree((prev) => (prev ? removeNode(prev, target.id) : prev));
      try {
        await adminApi.deleteCategory(target.id);
        setDeleteTarget(null);
        setDeleteError(null);
        setNonce((n) => n + 1);
      } catch (err: unknown) {
        setDeleteError(
          err instanceof Error ? err.message : "Delete failed.",
        );
        // Refetch restores the row (and the 400 "Category still has products"
        // alert stays visible inside the dialog).
        setNonce((n) => n + 1);
      } finally {
        setDeletePending(false);
      }
    },
    [deleteTarget],
  );

  // --- render ----------------------------------------------------------------

  const loading = tree === null && !loadError;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title="Categories"
        count={tree ? rows.length : undefined}
        actions={
          canManage ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => openCreate("")}
            >
              New root category
            </Button>
          ) : null
        }
      />

      {/* Chinese operator guide. */}
      <div className="mt-4 rounded-xl border border-primary/50 bg-primary-light/30 p-4 text-xs leading-relaxed text-ink-secondary">
        <p className="text-sm font-semibold text-ink">分类（Category）怎么用</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            分类是商品的<span className="font-semibold">固定归属</span>，一个商品只属于一个分类，决定它出现在哪个分类页和面包屑里；营销分组（New Arrivals、Best Sellers
            等）在左侧 Collections 页管理，两者不冲突。
          </li>
          <li>
            Parent 决定层级：不填是一级大类；选了上级就是子分类（如 Shoe Racks
            在 Storage &amp; Organization 下）。Sort 数字越小越靠前。
          </li>
          <li>
            分类页<span className="font-semibold">顶部横幅大图</span>（建议宽幅约
            3:1）在下方「Hero 样式」里配置背景图片；不配时分类页只显示居中标题，
            不影响使用。
          </li>
        </ul>
      </div>

      <div className="mt-4">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : loadError ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-card p-6"
          >
            <p className="text-sm font-semibold text-ink">
              Couldn&apos;t load categories.
            </p>
            <p className="mt-1 text-sm text-ink-muted">{loadError}</p>
            <Button
              variant="secondary"
              size="md"
              onClick={reload}
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No categories yet — create your first category."
            action={
              canManage ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => openCreate("")}
                >
                  New root category
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Categories</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-4 py-3">Name</th>
                  <th scope="col" className="px-4 py-3">Slug</th>
                  <th scope="col" className="px-4 py-3">Sort</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ node, depth }) => {
                  const rowBusy =
                    deletePending && deleteTarget?.id === node.id;
                  return (
                    <tr
                      key={node.id}
                      className="border-b border-border last:border-0"
                    >
                      <td
                        className="px-4 py-3 font-medium text-ink"
                        style={{ paddingLeft: `${1 + depth * 2}rem` }}
                      >
                        {node.name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="block max-w-[220px] truncate text-ink-secondary"
                          title={node.slug}
                        >
                          {node.slug}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">
                        {node.sortOrder}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          value={node.status}
                          tone={node.status === "ACTIVE" ? "green" : "red"}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {canManage ? (
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => openEdit(node)}
                              className="text-sm font-semibold text-cta hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => openCreate(node.id)}
                              className="text-sm font-semibold text-cta hover:underline"
                            >
                              <span aria-hidden="true">Add child</span>
                              <span className="sr-only">
                                {`Add child category under ${node.name}`}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openDelete(node)}
                              disabled={rowBusy}
                              className="text-sm font-semibold text-red-700 hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
                            >
                              Delete
                            </button>
                          </div>
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

      {/* Create / edit dialog */}
      <Dialog
        open={formOpen}
        onClose={closeForm}
        title={form.mode === "edit" ? "Edit category" : "Add category"}
        width="lg"
      >
        <form onSubmit={submitForm} noValidate>
          {formError ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700"
            >
              {formError}
            </p>
          ) : null}
          <div className="flex flex-col gap-4">
            <Field
              label="Name"
              htmlFor="cat-name"
              error={errors.name}
              hint="英文分类名，前台直接显示。"
            >
              <TextInput
                id="cat-name"
                value={form.name}
                maxLength={NAME_MAX}
                autoComplete="off"
                onChange={(e) => patchForm({ name: e.target.value })}
              />
            </Field>

            <Field label="Slug" htmlFor="cat-slug" error={errors.slug}>
              <TextInput
                id="cat-slug"
                value={form.slug}
                maxLength={SLUG_MAX}
                placeholder="folding-chair"
                autoComplete="off"
                onChange={(e) => patchForm({ slug: e.target.value })}
              />
              {!errors.slug ? (
                <>
                  <p className="mt-1 text-xs text-ink-muted">{SLUG_HINT}</p>
                  <p className="text-xs text-ink-muted">
                    分类页网址（/categories/ 后面那段），保存后不要随意改。
                  </p>
                </>
              ) : null}
            </Field>

            <Field
              label="Parent"
              htmlFor="cat-parent"
              error={errors.parentId}
              hint="上级分类：不选就是一级大类；选了上级则成为它的子分类。"
            >
              <Select
                id="cat-parent"
                value={form.parentId}
                onChange={(e) => patchForm({ parentId: e.target.value })}
              >
                <option value="" disabled={rootOptionDisabled}>
                  None (root)
                </option>
                {parentOptions.map(({ node, depth }) => (
                  <option key={node.id} value={node.id}>
                    {"  ".repeat(depth)}
                    {depth > 0 ? "– " : ""}
                    {node.name}
                  </option>
                ))}
              </Select>
              {rootOptionDisabled && !errors.parentId ? (
                <p className="mt-1 text-xs text-ink-muted">{ROOT_MOVE_HINT}</p>
              ) : null}
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Sort order"
                htmlFor="cat-sort"
                error={errors.sortOrder}
                hint="同级分类的排序，数字越小越靠前。"
              >
                <TextInput
                  id="cat-sort"
                  inputMode="numeric"
                  value={form.sortOrder}
                  autoComplete="off"
                  onChange={(e) => patchForm({ sortOrder: e.target.value })}
                />
              </Field>

              <Field
                label="Status"
                htmlFor="cat-status"
                hint="ACTIVE 前台可见；DISABLED 隐藏整个分类页（分类内商品本身状态不变）。"
              >
                <Select
                  id="cat-status"
                  value={form.status}
                  onChange={(e) =>
                    patchForm({ status: e.target.value as CategoryStatus })
                  }
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DISABLED">DISABLED</option>
                </Select>
              </Field>
            </div>

          </div>

          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-ink">Hero 样式（分类页顶部）</h3>
            <div className="mt-3">
              <HeroStyleFields
                idPrefix="cat-hero"
                value={form.heroStyle}
                onChange={(patch) =>
                  patchForm({ heroStyle: { ...form.heroStyle, ...patch } })
                }
                disabled={formPending}
              />
            </div>
            {errors.heroStyle ? (
              <p className="mt-2 text-xs text-red-700" role="alert">
                {errors.heroStyle}
              </p>
            ) : null}
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-ink">预览</h3>
            <div className="mt-3 flex flex-col gap-5">
              {/* Live: the very component the storefront renders, fed with the
                  values currently in this dialog. */}
              <LivePreview>
                <HeroBanner
                  name={form.name || "类目名称"}
                  style={heroStyleFromForm(form.heroStyle)}
                  fallbackImage={null}
                />
              </LivePreview>
              {form.mode === "edit" && form.slug ? (
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-ink-secondary">
                    整页预览（已保存版本）
                  </h4>
                  <div className="mt-3">
                    <StorefrontPreview path={`/categories/${form.slug}`} />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-ink-muted">
                  整页预览需要先保存：新建的类目还没有页面地址。
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={closeForm}
              disabled={formPending}
            >
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={formPending}
              aria-busy={formPending}
            >
              {formPending
                ? "Working…"
                : form.mode === "edit"
                  ? "Save"
                  : "Create"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete dialog */}
      <Dialog
        open={deleteTarget !== null}
        onClose={closeDelete}
        title="Delete category"
        width="sm"
      >
        {deleteTarget ? (
          <form onSubmit={submitDelete}>
            <p className="text-sm text-ink-secondary">
              {`Delete ${deleteTarget.name}? Child categories move to the root; this fails if any products use it.`}
            </p>
            {deleteError ? (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700"
              >
                {deleteError}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={closeDelete}
                disabled={deletePending}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={deletePending}
                aria-busy={deletePending}
                className="bg-red-600 hover:bg-red-700 active:bg-red-700"
              >
                {deletePending ? "Working…" : "Delete"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}
