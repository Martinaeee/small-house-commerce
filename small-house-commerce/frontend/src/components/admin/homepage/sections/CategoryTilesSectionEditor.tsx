"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminCategoryNode,
} from "@/lib/admin-api";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";

const MAX_CATEGORIES = 6;
type CategoryOption = { id: string; name: string };

function flattenCategories(nodes: AdminCategoryNode[]): CategoryOption[] {
  const result: CategoryOption[] = [];
  const visit = (items: AdminCategoryNode[]): void => {
    items.forEach((node) => {
      result.push({ id: node.id, name: node.name });
      visit(node.children ?? []);
    });
  };
  visit(nodes);
  return result;
}

export function CategoryTilesSectionEditor({
  section,
  onPayloadChange,
}: SectionPayloadEditorProps<"CATEGORY_TILES">): ReactNode {
  const { t } = useAdminI18n();
  const [options, setOptions] = useState<CategoryOption[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    adminApi
      .listCategories()
      .then((nodes) => {
        if (active) setOptions(flattenCategories(nodes));
      })
      .catch(() => {
        if (active) setOptions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const categoryIds = section.payload.categoryIds ?? [];
  const optionById = useMemo(
    () => new Map(options.map((option) => [option.id, option.name])),
    [options],
  );
  const filteredOptions = options.filter((option) => {
    const term = search.trim().toLowerCase();
    return (
      !categoryIds.includes(option.id) &&
      (term === "" || option.name.toLowerCase().includes(term))
    );
  });

  const addCategory = (categoryId: string): void => {
    onPayloadChange((payload) => {
      const current = payload.categoryIds ?? [];
      if (current.length >= MAX_CATEGORIES || current.includes(categoryId)) {
        return payload;
      }
      return { ...payload, categoryIds: [...current, categoryId] };
    });
  };

  const removeCategory = (categoryId: string): void => {
    onPayloadChange((payload) => ({
      ...payload,
      categoryIds: (payload.categoryIds ?? []).filter((id) => id !== categoryId),
    }));
  };

  const moveCategory = (categoryId: string, delta: -1 | 1): void => {
    onPayloadChange((payload) => {
      const current = payload.categoryIds ?? [];
      const index = current.indexOf(categoryId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return payload;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...payload, categoryIds: next };
    });
  };

  return (
    <section
      data-section-content-editor="CATEGORY_TILES"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {t("homepage_builder_category_tiles_categories")}
          </h2>
          <p className="text-xs text-ink-muted">
            {t("homepage_builder_category_tiles_limit", { max: MAX_CATEGORIES })}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-cta/40 px-3 py-1.5 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          disabled={categoryIds.length >= MAX_CATEGORIES}
          onClick={() => setSearch("")}
        >
          {t("homepage_builder_category_tiles_add")}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-ink-secondary" htmlFor={`category-search-${section.id}`}>
          {t("homepage_builder_category_tiles_search")}
        </label>
        <input
          id={`category-search-${section.id}`}
          type="search"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_category_tiles_search")}
          placeholder={t("homepage_builder_category_tiles_search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-secondary">
          {t("homepage_builder_category_tiles_available")}
        </span>
        {loading ? (
          <p className="text-xs text-ink-muted">
            {t("homepage_builder_category_tiles_loading")}
          </p>
        ) : filteredOptions.length > 0 ? (
          <div className="flex max-h-36 flex-col overflow-y-auto rounded-lg border border-border">
            {filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className="border-b border-border px-2 py-1.5 text-left text-sm text-ink last:border-b-0 hover:bg-surface"
                aria-label={option.name}
                onClick={() => addCategory(option.id)}
                disabled={categoryIds.length >= MAX_CATEGORIES}
              >
                {option.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-muted">
            {t("homepage_builder_category_tiles_no_results")}
          </p>
        )}
      </div>

      {categoryIds.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-ink-muted">
          {t("homepage_builder_category_tiles_empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {categoryIds.map((categoryId, index) => (
            <div
              key={categoryId}
              data-testid={`category-tile-row-${categoryId}`}
              className="flex items-center gap-2 rounded-lg border border-border p-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {optionById.get(categoryId) ?? categoryId}
              </span>
              <button
                type="button"
                className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                aria-label={t("homepage_builder_category_tiles_move_up", {
                  index: index + 1,
                })}
                disabled={index === 0}
                onClick={() => moveCategory(categoryId, -1)}
              >
                {t("homepage_builder_move_up")}
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                aria-label={t("homepage_builder_category_tiles_move_down", {
                  index: index + 1,
                })}
                disabled={index === categoryIds.length - 1}
                onClick={() => moveCategory(categoryId, 1)}
              >
                {t("homepage_builder_move_down")}
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 text-xs text-sale hover:bg-sale/10 disabled:cursor-not-allowed disabled:text-ink-muted"
                aria-label={t("homepage_builder_category_tiles_remove", { categoryId })}
                disabled={categoryIds.length <= 0}
                onClick={() => removeCategory(categoryId)}
              >
                {t("homepage_builder_category_tiles_remove", { categoryId })}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
