"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { adminApi, type AdminCategoryNode, type AdminCollectionRow } from "@/lib/admin-api";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  SHELL_LIMITS,
  type HeaderItem,
  type ShellIssue,
} from "@/lib/storefront-shell-document";
import { OrderedRows, type RowControls } from "./OrderedRows";
import { ShellLinkEditor } from "./ShellLinkEditor";

export type HeaderContentEditorProps = {
  items: readonly HeaderItem[];
  onChange: (items: HeaderItem[]) => void;
  pendingUploads: ReadonlySet<"horizontal" | "square">;
  issues?: readonly ShellIssue[];
};

type AddKind = HeaderItem["kind"];

function orderedActiveRoots(nodes: AdminCategoryNode[]): AdminCategoryNode[] {
  return nodes
    .filter((node) => node.parentId === null && node.status === "ACTIVE")
    .sort((left, right) =>
      left.sortOrder === right.sortOrder
        ? left.name.localeCompare(right.name)
        : left.sortOrder - right.sortOrder,
    );
}

function orderedActiveCollections(
  rows: AdminCollectionRow[],
): AdminCollectionRow[] {
  return rows
    .filter((row) => row.status === "ACTIVE")
    .sort((left, right) =>
      left.sortOrder === right.sortOrder
        ? left.name.localeCompare(right.name)
        : left.sortOrder - right.sortOrder,
    );
}

export function HeaderContentEditor({
  items,
  onChange,
  pendingUploads,
  issues = [],
}: HeaderContentEditorProps) {
  const { t } = useAdminI18n();
  const [roots, setRoots] = useState<AdminCategoryNode[]>([]);
  const [collections, setCollections] = useState<AdminCollectionRow[]>([]);
  const [optionsSettled, setOptionsSettled] = useState(false);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [addKind, setAddKind] = useState<AddKind>("CATEGORY_ROOT");
  const [chosenTargetId, setChosenTargetId] = useState("");
  const [limitMessage, setLimitMessage] = useState<
    "enabled" | "rows" | null
  >(null);
  const rowRefs = useRef(new Map<string, HTMLFieldSetElement>());

  useEffect(() => {
    let active = true;
    Promise.all([adminApi.listCategories(), adminApi.listCollections()])
      .then(([categoryRows, collectionPage]) => {
        if (!active) return;
        setRoots(orderedActiveRoots(categoryRows));
        setCollections(orderedActiveCollections(collectionPage.items));
        setOptionsFailed(false);
        setOptionsSettled(true);
      })
      .catch(() => {
        if (!active) return;
        setRoots([]);
        setCollections([]);
        setOptionsFailed(true);
        setOptionsSettled(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const rootNames = useMemo(
    () => new Map(roots.map((row) => [row.id, row.name])),
    [roots],
  );
  const collectionNames = useMemo(
    () => new Map(collections.map((row) => [row.id, row.name])),
    [collections],
  );
  const enabledCount = items.filter((item) => item.enabled).length;
  const locked = pendingUploads.size > 0;
  const atRowLimit = items.length >= SHELL_LIMITS.maxHeaderRows;
  const targetRows = addKind === "CATEGORY_ROOT" ? roots : collections;
  const selectedTargetId = targetRows.some(
    (row) => row.id === chosenTargetId,
  )
    ? chosenTargetId
    : (targetRows[0]?.id ?? "");

  const labelFor = (item: HeaderItem): string => {
    if (item.kind === "STRUCTURED_LINK") return item.label || item.id;
    const resolved =
      item.kind === "CATEGORY_ROOT"
        ? rootNames.get(item.targetId)
        : collectionNames.get(item.targetId);
    return item.labelOverride || resolved || item.targetId;
  };

  const updateItem = (
    id: string,
    update: (item: HeaderItem) => HeaderItem,
  ) => {
    onChange(items.map((item) => (item.id === id ? update(item) : item)));
  };

  const addItem = () => {
    if (locked || atRowLimit) {
      if (atRowLimit) setLimitMessage("rows");
      return;
    }
    const enabled = enabledCount < SHELL_LIMITS.maxEnabledHeaderItems;
    const id = crypto.randomUUID();
    let next: HeaderItem;
    if (addKind === "STRUCTURED_LINK") {
      next = {
        id,
        kind: "STRUCTURED_LINK",
        label: "Link",
        link: { type: "INTERNAL", path: "/" },
        enabled,
      };
    } else {
      if (!selectedTargetId) return;
      next = {
        id,
        kind: addKind,
        targetId: selectedTargetId,
        labelOverride: "",
        enabled,
      };
    }
    setLimitMessage(null);
    onChange([...items, next]);
  };

  const toggleItem = (item: HeaderItem) => {
    if (locked) return;
    if (!item.enabled && enabledCount >= SHELL_LIMITS.maxEnabledHeaderItems) {
      setLimitMessage("enabled");
      return;
    }
    setLimitMessage(null);
    updateItem(item.id, (current) => ({
      ...current,
      enabled: !current.enabled,
    }));
  };

  const addressedIssues = issues.filter(
    (issue): issue is ShellIssue & { itemId: string } =>
      typeof issue.itemId === "string" &&
      items.some((item) => item.id === issue.itemId),
  );

  return (
    <section className="min-w-0" aria-labelledby="storefront-shell-header-heading">
      <h2
        id="storefront-shell-header-heading"
        className="text-lg font-semibold text-ink"
      >
        {t("storefront_shell_tab_header")}
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">
        {t("storefront_shell_header_hint")}
      </p>

      {addressedIssues.length > 0 ? (
        <div className="mt-4 space-y-2">
          {addressedIssues.map((issue) => (
            <button
              key={`${issue.code}:${issue.itemId}`}
              type="button"
              onClick={() => rowRefs.current.get(issue.itemId)?.focus()}
              className="block w-full rounded-lg border border-admin-warning bg-admin-warning-soft px-3 py-2 text-left text-sm text-ink"
            >
              {issue.message}
            </button>
          ))}
        </div>
      ) : null}

      {enabledCount === 0 ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-admin-warning bg-admin-warning-soft px-3 py-2 text-sm text-ink"
        >
          {t("storefront_shell_header_zero_enabled")}
        </p>
      ) : null}
      {limitMessage === "enabled" ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-admin-warning bg-admin-warning-soft px-3 py-2 text-sm text-ink"
        >
          {t("storefront_shell_header_enabled_limit", {
            max: SHELL_LIMITS.maxEnabledHeaderItems,
          })}
        </p>
      ) : null}
      {atRowLimit || limitMessage === "rows" ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-admin-warning bg-admin-warning-soft px-3 py-2 text-sm text-ink"
        >
          {t("storefront_shell_header_row_limit", {
            max: SHELL_LIMITS.maxHeaderRows,
          })}
        </p>
      ) : null}
      {optionsFailed ? (
        <p className="mt-3 text-sm text-admin-error">
          {t("storefront_shell_header_targets_error")}
        </p>
      ) : null}

      <fieldset
        disabled={locked || atRowLimit}
        className="mt-5 grid min-w-0 gap-3 rounded-xl border border-admin-border p-4"
      >
        <legend className="px-1 text-sm font-semibold text-ink">
          {t("storefront_shell_header_add_item")}
        </legend>
        <label className="min-w-0 text-sm font-medium text-ink">
          {t("storefront_shell_header_kind")}
          <select
            aria-label={t("storefront_shell_header_add_kind")}
            value={addKind}
            onChange={(event) => {
              setAddKind(event.target.value as AddKind);
              setChosenTargetId("");
            }}
            className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border bg-admin-surface px-3 py-2"
          >
            <option value="CATEGORY_ROOT">
              {t("storefront_shell_header_kind_category")}
            </option>
            <option value="COLLECTION">
              {t("storefront_shell_header_kind_collection")}
            </option>
            <option value="STRUCTURED_LINK">
              {t("storefront_shell_header_kind_link")}
            </option>
          </select>
        </label>

        {addKind === "STRUCTURED_LINK" ? (
          <p className="self-center text-sm text-ink-secondary">
            {t("storefront_shell_header_link_after_add")}
          </p>
        ) : (
          <label className="min-w-0 text-sm font-medium text-ink">
            {t("storefront_shell_header_target")}
            <select
              aria-label={t("storefront_shell_header_add_target")}
              value={selectedTargetId}
              onChange={(event) => setChosenTargetId(event.target.value)}
              disabled={!optionsSettled || targetRows.length === 0}
              className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border bg-admin-surface px-3 py-2"
            >
              {targetRows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={addItem}
          disabled={
            locked ||
            atRowLimit ||
            (addKind !== "STRUCTURED_LINK" && !selectedTargetId)
          }
          className="rounded-lg bg-admin-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("storefront_shell_header_add")}
        </button>
      </fieldset>

      <div className="mt-5">
        <OrderedRows
          items={items}
          maxItems={SHELL_LIMITS.maxHeaderRows}
          disabled={locked}
          labelFor={labelFor}
          onChange={onChange}
          renderItem={(item, index, controls) => (
            <HeaderRow
              item={item}
              index={index}
              controls={controls}
              resolvedName={
                item.kind === "CATEGORY_ROOT"
                  ? rootNames.get(item.targetId)
                  : item.kind === "COLLECTION"
                    ? collectionNames.get(item.targetId)
                    : undefined
              }
              targetUnavailable={
                optionsSettled &&
                item.kind !== "STRUCTURED_LINK" &&
                (item.kind === "CATEGORY_ROOT"
                  ? !rootNames.has(item.targetId)
                  : !collectionNames.has(item.targetId))
              }
              onRef={(node) => {
                if (node) rowRefs.current.set(item.id, node);
                else rowRefs.current.delete(item.id);
              }}
              onUpdate={(update) => updateItem(item.id, update)}
              onToggle={() => toggleItem(item)}
            />
          )}
        />
      </div>
    </section>
  );
}

function HeaderRow({
  item,
  index,
  controls,
  resolvedName,
  targetUnavailable,
  onRef,
  onUpdate,
  onToggle,
}: {
  item: HeaderItem;
  index: number;
  controls: RowControls;
  resolvedName?: string;
  targetUnavailable: boolean;
  onRef: (node: HTMLFieldSetElement | null) => void;
  onUpdate: (update: (item: HeaderItem) => HeaderItem) => void;
  onToggle: () => void;
}) {
  const { t } = useAdminI18n();
  const updateStructured = (
    update: Partial<Extract<HeaderItem, { kind: "STRUCTURED_LINK" }>>,
  ) => {
    onUpdate((current) =>
      current.kind === "STRUCTURED_LINK" ? { ...current, ...update } : current,
    );
  };

  return (
    <fieldset
      ref={onRef}
      tabIndex={-1}
      data-testid={`header-row-${item.id}`}
      className="min-w-0 rounded-xl border border-admin-border bg-admin-surface p-4 focus:outline-none focus:ring-2 focus:ring-admin-primary"
    >
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {t("storefront_shell_header_row", { number: index + 1 })}
      </legend>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          {...controls.dragHandleProps}
          aria-label={t("storefront_shell_drag")}
          className="cursor-grab touch-none rounded-lg border border-admin-border px-2 py-1.5 text-ink-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          ⠿
        </button>
        <button
          type="button"
          aria-label={t("storefront_shell_move_up")}
          disabled={controls.disabled || !controls.canMoveUp}
          onClick={controls.moveUp}
          className="rounded-lg border border-admin-border px-2 py-1.5 text-sm disabled:opacity-40"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={t("storefront_shell_move_down")}
          disabled={controls.disabled || !controls.canMoveDown}
          onClick={controls.moveDown}
          className="rounded-lg border border-admin-border px-2 py-1.5 text-sm disabled:opacity-40"
        >
          ↓
        </button>
        <button
          type="button"
          aria-label={
            item.enabled
              ? t("storefront_shell_hide")
              : t("storefront_shell_enable")
          }
          aria-pressed={item.enabled}
          disabled={controls.disabled}
          onClick={onToggle}
          className="rounded-lg border border-admin-border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          {item.enabled
            ? t("storefront_shell_visible")
            : t("storefront_shell_hidden")}
        </button>
        <button
          type="button"
          aria-label={t("storefront_shell_delete")}
          disabled={controls.disabled}
          onClick={controls.remove}
          className="ml-auto rounded-lg border border-admin-error px-3 py-1.5 text-sm text-admin-error disabled:opacity-40"
        >
          {t("storefront_shell_delete")}
        </button>
      </div>

      <div className="mt-4 min-w-0">
        {item.kind === "STRUCTURED_LINK" ? (
          <ShellLinkEditor
            label={item.label}
            link={item.link}
            disabled={controls.disabled}
            onLabelChange={(label) => updateStructured({ label })}
            onLinkChange={(link) => updateStructured({ link })}
          />
        ) : (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-muted">
                {t("storefront_shell_header_target")}
              </p>
              <p className="mt-1 truncate text-sm text-ink" title={resolvedName ?? item.targetId}>
                {resolvedName ?? item.targetId}
              </p>
              {targetUnavailable ? (
                <p className="mt-1 text-xs text-admin-error">
                  {t("storefront_shell_header_target_unavailable")}
                </p>
              ) : null}
            </div>
            <label className="min-w-0 text-sm font-medium text-ink">
              {t("storefront_shell_header_label")}
              <input
                type="text"
                aria-label={t("storefront_shell_header_label")}
                value={item.labelOverride}
                maxLength={SHELL_LIMITS.label}
                onChange={(event) =>
                  onUpdate((current) =>
                    current.kind === "STRUCTURED_LINK"
                      ? current
                      : { ...current, labelOverride: event.target.value },
                  )
                }
                className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2"
              />
            </label>
          </div>
        )}
      </div>
    </fieldset>
  );
}
