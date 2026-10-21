"use client";

import {
  useCallback,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useAdminI18n } from "@/lib/admin-i18n";

export type RowControls = {
  moveUp: () => void;
  moveDown: () => void;
  remove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled: boolean;
  dragHandleProps: ButtonHTMLAttributes<HTMLButtonElement> & {
    ref: (node: HTMLButtonElement | null) => void;
  };
};

export type OrderedRowsProps<T extends { id: string }> = {
  items: readonly T[];
  maxItems: number;
  disabled?: boolean;
  labelFor: (item: T) => string;
  onChange: (items: T[]) => void;
  renderItem: (
    item: T,
    index: number,
    controls: RowControls,
  ) => ReactNode;
};

export function OrderedRows<T extends { id: string }>({
  items,
  maxItems,
  disabled = false,
  labelFor,
  onChange,
  renderItem,
}: OrderedRowsProps<T>) {
  const { t } = useAdminI18n();
  const [announcement, setAnnouncement] = useState("");
  const ids = items.map((item) => item.id);
  const overLimit = items.length > maxItems;
  const orderingDisabled = disabled || overLimit;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const announcePosition = useCallback(
    (item: T, position: number, total: number) => {
      setAnnouncement(
        t("storefront_shell_order_position", {
          label: labelFor(item),
          position,
          total,
        }),
      );
    },
    [labelFor, t],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (
        orderingDisabled ||
        from < 0 ||
        to < 0 ||
        from >= items.length ||
        to >= items.length ||
        from === to
      ) {
        return;
      }
      const item = items[from];
      onChange(arrayMove([...items], from, to));
      announcePosition(item, to + 1, items.length);
    },
    [announcePosition, items, onChange, orderingDisabled],
  );

  const onDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    },
    [ids, move],
  );

  return (
    <div className="min-w-0">
      {overLimit ? (
        <p role="alert" className="mb-3 text-sm text-admin-error">
          {t("storefront_shell_order_too_many", { max: maxItems })}
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="min-w-0 space-y-3">
            {items.map((item, index) => (
              <SortableRow
                key={item.id}
                item={item}
                index={index}
                count={items.length}
                disabled={disabled}
                orderingDisabled={orderingDisabled}
                label={labelFor(item)}
                onMove={move}
                onRemove={() => {
                  if (disabled) return;
                  onChange(items.filter((entry) => entry.id !== item.id));
                }}
                renderItem={renderItem}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <p
        role="status"
        data-testid="ordered-rows-announcement"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </p>
    </div>
  );
}

function SortableRow<T extends { id: string }>({
  item,
  index,
  count,
  disabled,
  orderingDisabled,
  label,
  onMove,
  onRemove,
  renderItem,
}: {
  item: T;
  index: number;
  count: number;
  disabled: boolean;
  orderingDisabled: boolean;
  label: string;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  renderItem: OrderedRowsProps<T>["renderItem"];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: orderingDisabled });

  const transformStyle =
    transform && (transform.x !== 0 || transform.y !== 0)
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined;

  const controls: RowControls = {
    moveUp: () => onMove(index, index - 1),
    moveDown: () => onMove(index, index + 1),
    remove: onRemove,
    canMoveUp: !orderingDisabled && index > 0,
    canMoveDown: !orderingDisabled && index < count - 1,
    disabled,
    dragHandleProps: {
      ref: setActivatorNodeRef,
      ...attributes,
      ...listeners,
      disabled: orderingDisabled,
    },
  };

  return (
    <li
      ref={setNodeRef}
      data-ordered-row={item.id}
      aria-label={label}
      style={{
        transform: transformStyle,
        transition: transition ?? undefined,
      }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      {renderItem(item, index, controls)}
    </li>
  );
}
