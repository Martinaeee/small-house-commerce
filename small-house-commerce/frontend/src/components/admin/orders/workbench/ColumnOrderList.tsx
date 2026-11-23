"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useAdminI18n } from "@/lib/admin-i18n";
import { WORKBENCH_COLUMNS, type WorkbenchColumnKey } from "./columns";

const COLUMN_BY_KEY = new Map(
  WORKBENCH_COLUMNS.map((column) => [column.key, column]),
);

export interface ColumnOrderListProps {
  /** The full column order, hidden ones included: they keep their place. */
  order: readonly WorkbenchColumnKey[];
  hidden: readonly WorkbenchColumnKey[];
  onToggle: (key: WorkbenchColumnKey) => void;
  onMove: (from: number, to: number) => void;
}

/**
 * The column panel: what to show, and in which order.
 *
 * A hidden column keeps its slot, so switching it back on returns it where the
 * operator left it instead of at the end of the table. The handle (not the
 * whole row) is the drag activator, so the checkbox stays a checkbox; the
 * keyboard sensor keeps the same move reachable without a pointer.
 */
export function ColumnOrderList({
  order,
  hidden,
  onToggle,
  onMove,
}: ColumnOrderListProps) {
  const { t } = useAdminI18n();
  const [announcement, setAnnouncement] = useState("");
  const keys = useMemo(() => [...order], [order]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      const from = keys.indexOf(String(active.id) as WorkbenchColumnKey);
      const to = keys.indexOf(String(over.id) as WorkbenchColumnKey);
      if (from < 0 || to < 0) return;
      const column = COLUMN_BY_KEY.get(keys[from]!);
      onMove(from, to);
      if (column) {
        setAnnouncement(
          t("orders_columns_moved", {
            label: t(column.labelKey),
            position: to + 1,
            total: keys.length,
          }),
        );
      }
    },
    [keys, onMove, t],
  );

  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">
        {t("orders_columns")}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={keys} strategy={verticalListSortingStrategy}>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {keys.map((key, index) => (
              <SortableColumnRow
                key={key}
                columnKey={key}
                index={index}
                hidden={hidden.includes(key)}
                onToggle={onToggle}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="column-order-announcement"
        className="sr-only"
      >
        {announcement}
      </p>
      <p className="mt-2 text-[11px] text-ink-muted">
        {t("orders_columns_drag_hint")}
      </p>
    </div>
  );
}

function SortableColumnRow({
  columnKey,
  index,
  hidden,
  onToggle,
}: {
  columnKey: WorkbenchColumnKey;
  index: number;
  hidden: boolean;
  onToggle: (key: WorkbenchColumnKey) => void;
}) {
  const { t } = useAdminI18n();
  const column = COLUMN_BY_KEY.get(columnKey)!;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: columnKey });

  const transformStyle =
    transform && (transform.x !== 0 || transform.y !== 0)
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined;

  const style: CSSProperties = {
    transform: transformStyle,
    transition: transition ?? undefined,
  };

  return (
    <li
      ref={setNodeRef}
      data-column-row={columnKey}
      style={style}
      className={`flex items-center gap-1.5 rounded ${isDragging ? "relative z-10 bg-background" : ""}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("orders_columns_drag", { label: t(column.labelKey) })}
        aria-roledescription={t("orders_columns_drag_role")}
        className="cursor-grab rounded px-1 py-0.5 text-ink-muted hover:bg-background hover:text-ink active:cursor-grabbing"
        data-testid={`column-drag-${columnKey}`}
      >
        ⠿
      </button>
      <label className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-[13px] text-ink-secondary">
        <input
          type="checkbox"
          checked={!hidden}
          onChange={() => onToggle(columnKey)}
          aria-label={t(column.labelKey)}
        />
        <span className="truncate">{t(column.labelKey)}</span>
        <span className="ml-auto text-[11px] text-ink-muted">{index + 1}</span>
      </label>
    </li>
  );
}
