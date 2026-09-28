"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { useBufferedValue } from "@/components/admin/homepage/AnnouncementSettings";
import type { LinkValue } from "@/lib/homepage-document";
import {
  adminApi,
  type AdminCategoryNode,
  type AdminCollectionRow,
  type Paged,
} from "@/lib/admin-api";

/**
 * Full link picker (plan Task 18, design spec §5.6). Replaces the minimal
 * inline control Dr11/Dr14 shipped (ledger Ruling 27): a type dropdown
 * (Product / Collection / Category / Landing Page / External) plus a
 * searchable single-select entity list and an https-only buffered external URL
 * field, a resolved-form preview line and a clear button.
 *
 * Write-path contract with the consumers: entity selects, type switches and
 * clear are discrete choices that go straight to `onChange` (the owning panel
 * routes them to a `commit`/`mutate` dispatch on its latest document). The
 * external URL text is buffered like every other free-text field (Task 14
 * `useBufferedValue`, 300 ms + blur) and only ever fires complete parseable
 * https URLs; a buffered path therefore never builds a document from a
 * render-captured snapshot (Task 14 R32).
 */

const ENTITY_TYPES = ["PRODUCT", "COLLECTION", "CATEGORY", "LANDING"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];
type LinkType = EntityType | "EXTERNAL";

/** Static mapping: `LANDING` stores as `homepage_builder_link_type_LANDING`. */
const LINK_TYPE_LABEL_KEYS: Record<LinkType, TKey> = {
  PRODUCT: "homepage_builder_link_type_PRODUCT",
  COLLECTION: "homepage_builder_link_type_COLLECTION",
  CATEGORY: "homepage_builder_link_type_CATEGORY",
  LANDING: "homepage_builder_link_type_LANDING",
  EXTERNAL: "homepage_builder_link_type_EXTERNAL",
};

const SERVER_SEARCH_DEBOUNCE_MS = 250;

type EntityOption = { id: string; name: string };

function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

function flattenCategoryNodes(nodes: AdminCategoryNode[]): EntityOption[] {
  const out: EntityOption[] = [];
  const walk = (list: AdminCategoryNode[]): void => {
    for (const node of list) {
      out.push({ id: node.id, name: node.name });
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Entity options for the current link type. PRODUCT/LANDING pages expose
 * server-side search (`listProducts`/`listLandingPages`), so those re-fetch
 * debounced per keystroke; COLLECTION/CATEGORY return small whole lists
 * (`listCollections`/`listCategories`) that are filtered client-side. A
 * monotonically increasing sequence discards stale resolutions after a type or
 * search switch; the initial fetch for a type change fires immediately while
 * search-keystroke fetches debounce.
 */
function useEntityOptions(
  type: LinkType | "",
  search: string,
): {
  options: EntityOption[];
  /** Freshness + settlement tag for the current `options` payload. */
  result: { type: LinkType | ""; search: string };
} {
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [result, setResult] = useState<{ type: LinkType | ""; search: string }>(
    { type: "", search: "" },
  );
  const seqRef = useRef(0);
  const searchRef = useRef("");

  const productSearchKey = type === "PRODUCT" || type === "LANDING" ? search : "";

  useEffect(() => {
    if (type === "" || type === "EXTERNAL") {
      // Fold any in-flight request so it can never resolve into current
      // state. Stale options keep their freshness tag until a fetch for the
      // active type lands, so the renderer never mistakes them for fresh.
      seqRef.current += 1;
      searchRef.current = "";
      return;
    }
    const productSearch = productSearchKey;
    const prevSearch = searchRef.current;
    searchRef.current = productSearch;
    const seq = ++seqRef.current;

    if (type === "COLLECTION" || type === "CATEGORY") {
      const request =
        type === "COLLECTION"
          ? adminApi.listCollections()
          : adminApi.listCategories();
      request
        .then((res) => {
          if (seqRef.current !== seq) return;
          setOptions(
            type === "COLLECTION"
              ? (res as Paged<AdminCollectionRow>).items.map((row) => ({
                  id: row.id,
                  name: row.name,
                }))
              : flattenCategoryNodes(res as AdminCategoryNode[]),
          );
          setResult({ type, search: productSearch });
        })
        .catch(() => {
          if (seqRef.current !== seq) return;
          setOptions([]);
          setResult({ type, search: productSearch });
        });
      return;
    }

    const term = productSearch.trim();
    const timer = setTimeout(
      () => {
        const request =
          type === "PRODUCT"
            ? adminApi.listProducts({
                search: term || undefined,
                page: 1,
                pageSize: 20,
              })
            : adminApi.listLandingPages({
                search: term || undefined,
                page: 1,
                pageSize: 20,
              });
        request
          .then((res) => {
            if (seqRef.current !== seq) return;
            setOptions(res.items.map((row) => ({ id: row.id, name: row.name })));
            setResult({ type, search: productSearch });
          })
          .catch(() => {
            if (seqRef.current !== seq) return;
            setOptions([]);
            setResult({ type, search: productSearch });
          });
      },
      prevSearch === productSearch ? 0 : SERVER_SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [type, productSearchKey]);

  return { options, result };
}

export function LinkPicker({
  value,
  onChange,
  allowExternal,
}: {
  value: LinkValue | null;
  onChange(value: LinkValue | null): void;
  allowExternal: boolean;
}): ReactNode {
  const { t } = useAdminI18n();
  const [type, setType] = useState<LinkType | "">(value?.type ?? "");
  const [lastSeenType, setLastSeenType] = useState<LinkType | "">(
    value?.type ?? "",
  );
  const [searchInput, setSearchInput] = useState("");
  // Targeted PRODUCT lookup result, keyed by id so a stale name can never
  // surface for a different selection.
  const [lookup, setLookup] = useState<{ id: string; name: string } | null>(null);

  // Adopt a committed link that arrived from elsewhere (undo, parent patch).
  const committedType = value?.type ?? "";
  if (value !== null && committedType !== lastSeenType) {
    setLastSeenType(committedType);
    setType(committedType);
  }

  const valueId = value !== null && value.type !== "EXTERNAL" ? value.id : null;

  // Cleared/selected-away ids invalidate a stale targeted lookup (derived
  // state pattern: no effect needed).
  if (lookup !== null && lookup.id !== valueId) {
    setLookup(null);
  }

  // Only surface a change the consumer has not already applied: a no-op write
  // (e.g. a type switch on an empty picker) would otherwise mint a spurious
  // undo entry, since the panels clone the document on every mutation.
  const commitChange = (next: LinkValue | null): void => {
    if (JSON.stringify(next) === JSON.stringify(value)) return;
    onChange(next);
  };

  // Buffered external URL: only complete parseable https URLs ever fire; the
  // owning panel routes the `onChange` to a race-safe `mutate` dispatch.
  // The buffer keeps invalid text (instant in-field validation), reverting
  // only when the committed value changes from outside (undo, another panel).
  const externalText =
    value !== null && value.type === "EXTERNAL" ? value.url : "";
  const external = useBufferedValue(
    externalText,
    (next) => {
      if (type !== "EXTERNAL") return;
      const candidate = next.trim();
      if (candidate === "") {
        commitChange(null);
        return;
      }
      if (isHttpsUrl(candidate)) {
        commitChange({ type: "EXTERNAL", url: candidate });
      }
    },
  );

  const switchType = (nextType: LinkType | ""): void => {
    setType(nextType);
    setSearchInput("");
    if (value !== null && value.type === nextType) {
      // Same committed type: keep the value on the field.
      return;
    }
    external.reset("");
    commitChange(null);
  };

  const selectEntity = (option: EntityOption): void => {
    if (type === "" || type === "EXTERNAL") return;
    commitChange({ type, id: option.id });
  };

  const clear = (): void => {
    external.reset("");
    setType("");
    setLastSeenType("");
    setSearchInput("");
    commitChange(null);
  };

  const { options, result } = useEntityOptions(type, searchInput);

  const valueType = value !== null ? value.type : null;
  const productSearchKey =
    type === "PRODUCT" || type === "LANDING" ? searchInput : "";
  const isEntityType = type !== "" && type !== "EXTERNAL";
  const fresh = result.type === type && isEntityType;
  const settled = result.type === type && result.search === productSearchKey;

  // Honest name resolution: the loaded option list first, then a targeted
  // PRODUCT lookup (the one entity endpoint that supports it), and the id as
  // the honest fallback when neither knows the entity — never a wrong name.
  useEffect(() => {
    if (valueId === null || valueType === "EXTERNAL") return;
    if (!fresh || !settled) return;
    if (options.some((option) => option.id === valueId)) return;
    if (valueType !== "PRODUCT") return;
    let active = true;
    adminApi
      .getProduct(valueId)
      .then((row) => {
        if (active) setLookup({ id: valueId, name: row.name });
      })
      .catch(() => {
        /* the id fallback stays visible */
      });
    return () => {
      active = false;
    };
  }, [valueId, valueType, fresh, settled, options]);

  const displayName =
    valueId !== null
      ? (options.find((option) => option.id === valueId)?.name ??
        (lookup !== null && lookup.id === valueId ? lookup.name : null) ??
        valueId)
      : "";

  const clientFiltered = type === "COLLECTION" || type === "CATEGORY";
  const visibleOptions = useMemo(() => {
    if (!clientFiltered) return options;
    const term = searchInput.trim().toLowerCase();
    if (term === "") return options;
    return options.filter((option) =>
      option.name.toLowerCase().includes(term),
    );
  }, [options, clientFiltered, searchInput]);

  const trimmed = external.value.trim();
  const invalidExternal =
    type === "EXTERNAL" && trimmed !== "" && !isHttpsUrl(trimmed);

  const pickTitle =
    type !== "" ? t("homepage_builder_link_pick_title", { type: t(LINK_TYPE_LABEL_KEYS[type as LinkType]) }) : "";
  const searchLabel = t("homepage_builder_link_search_placeholder");

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <select
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-ink"
          aria-label={t("homepage_builder_link_type")}
          value={type}
          onChange={(event) => switchType(event.target.value as LinkType | "")}
        >
          <option value="">—</option>
          {ENTITY_TYPES.map((option) => (
            <option key={option} value={option}>
              {t(LINK_TYPE_LABEL_KEYS[option])}
            </option>
          ))}
          {allowExternal ? (
            <option value="EXTERNAL">{t(LINK_TYPE_LABEL_KEYS.EXTERNAL)}</option>
          ) : null}
        </select>
        {value !== null ? (
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-1 text-sm text-ink-muted hover:text-sale"
            aria-label={t("homepage_builder_link_clear")}
            onClick={clear}
          >
            ✕
          </button>
        ) : null}
      </div>

      {isEntityType ? (
        <div className="flex min-w-0 flex-col gap-1">
          <input
            type="search"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-ink"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <ul
            className="mb-1 max-h-40 min-w-0 list-none divide-y divide-border overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-card p-0"
            aria-label={pickTitle}
          >
            {fresh
              ? visibleOptions.map((option) => {
                  const selected =
                    value !== null &&
                    value.type === type &&
                    value.id === option.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        title={option.name}
                        onClick={() => selectEntity(option)}
                        className={`w-full truncate px-2 py-1 text-left text-xs ${
                          selected
                            ? "bg-cta/10 font-medium text-cta"
                            : "text-ink hover:bg-surface"
                        }`}
                      >
                        {option.name}
                      </button>
                    </li>
                  );
                })
              : null}
            {fresh && settled && visibleOptions.length === 0 ? (
              <li className="px-2 py-1 text-xs text-ink-muted">
                {t("homepage_builder_link_empty_results")}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {type === "EXTERNAL" ? (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            className="min-w-0 rounded-lg border border-border bg-card px-2 py-1.5 font-mono text-xs text-ink"
            aria-label={t("homepage_builder_link_external_url")}
            placeholder="https://…"
            value={external.value}
            onChange={(event) => external.change(event.target.value)}
            onBlur={external.blur}
          />
          {invalidExternal ? (
            <p className="text-xs text-sale">
              {t("homepage_builder_link_external_invalid")}
            </p>
          ) : null}
        </div>
      ) : null}

      {value !== null ? (
        <div className="flex min-w-0 items-center gap-2">
          {value.type === "EXTERNAL" ? (
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-secondary">
              {value.url}
            </span>
          ) : (
            <span
              className="min-w-0 flex-1 truncate text-xs text-ink-secondary"
              title={displayName}
            >
              {t("homepage_builder_link_resolved", { name: displayName })}
            </span>
          )}
          {value.type === "PRODUCT" ? (
            <a
              href={`/admin/products/${value.id}/edit`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-xs text-cta hover:underline"
            >
              {t("homepage_builder_link_edit_product")}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}