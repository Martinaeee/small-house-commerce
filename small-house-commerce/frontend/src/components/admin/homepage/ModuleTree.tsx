"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
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
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";
import { SlideList } from "@/components/admin/homepage/SlideList";
import {
  duplicateSection,
  moveSection,
  removeSection,
  updateSection,
  type HomepageDocument,
  type HomepageSection,
  type SectionType,
} from "@/lib/homepage-document";

/**
 * Left pane: the homepage module tree (sections + announcement bar).
 *
 * Sections sort with dnd-kit (`DndContext` + `SortableContext` +
 * `useSortable`); the keyboard sensor is enabled with
 * `sortableKeyboardCoordinates` so a section can be picked up with Space,
 * walked with the arrow keys and dropped with Space again. Every mutation
 * commits through the reducer, which keeps one history entry per action.
 */

/**
 * Selection sentinel for the announcement bar pseudo-node (ledger Ruling 29).
 * It travels through the existing `selectedSectionId`, so the Task 12 context
 * keeps its twelve members; the shell routes the right pane on this value.
 */
export const ANNOUNCEMENT_SELECTION_ID = "__announcement__";

/** Sections the operator may duplicate/delete; every other type is fixed. */
const ADDABLE_SECTION_TYPES: ReadonlySet<SectionType> = new Set<SectionType>([
  "PRODUCT_GRID",
  "PRODUCT_STORY",
]);

type LastRemoved = { section: HomepageSection; index: number };

export function ModuleTree(): ReactNode {
  const { t } = useAdminI18n();
  const {
    state,
    dispatch,
    selectedSectionId,
    setSelectedSectionId,
    selectedSlideId,
    setSelectedSlideId,
  } = useHomepageEditor();
  const [lastRemoved, setLastRemoved] = useState<LastRemoved | null>(null);

  const document = state.document;
  const sections = useMemo(
    () => [...document.sections].sort((a, b) => a.sortOrder - b.sortOrder),
    [document.sections],
  );
  const sectionIds = useMemo(
    () => sections.map((section) => section.id),
    [sections],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const commit = useCallback(
    (next: HomepageDocument): void => {
      dispatch({ type: "commit", document: next });
    },
    [dispatch],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = sectionIds.indexOf(String(active.id));
      const to = sectionIds.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      commit(moveSection(document, from, to));
    },
    [commit, document, sectionIds],
  );

  const handleDelete = useCallback(
    (section: HomepageSection, index: number): void => {
      setLastRemoved({ section: structuredClone(section), index });
      if (selectedSectionId === section.id) setSelectedSectionId(null);
      if (
        section.type === "HERO" &&
        selectedSlideId !== null &&
        section.payload.slides.some((slide) => slide.id === selectedSlideId)
      ) {
        setSelectedSlideId(null);
      }
      commit(removeSection(document, section.id));
    },
    [
      commit,
      document,
      selectedSectionId,
      selectedSlideId,
      setSelectedSectionId,
      setSelectedSlideId,
    ],
  );

  const handleUndoDelete = useCallback((): void => {
    if (!lastRemoved) return;
    const restored = structuredClone(document);
    const index = Math.min(
      Math.max(lastRemoved.index, 0),
      restored.sections.length,
    );
    restored.sections.splice(index, 0, structuredClone(lastRemoved.section));
    restored.sections.forEach((section, position) => {
      section.sortOrder = position * 10;
    });
    setLastRemoved(null);
    commit(restored);
  }, [commit, document, lastRemoved]);

  return (
    <div
      data-panel="module-tree"
      className="flex min-h-[320px] flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-ink">
        {t("homepage_builder_pane_modules")}
      </h2>

      {lastRemoved ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-admin-warning bg-admin-warning-soft px-3 py-2">
          <span className="min-w-0 truncate text-xs text-ink-secondary">
            {lastRemoved.section.title ?? lastRemoved.section.type}
          </span>
          <button
            type="button"
            onClick={handleUndoDelete}
            className="shrink-0 text-xs font-semibold text-cta hover:underline"
          >
            {t("homepage_builder_section_undo_delete")}
          </button>
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sectionIds}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-1">
            {sections.map((section, index) => (
              <SortableSectionRow
                key={section.id}
                section={section}
                index={index}
                selected={section.id === selectedSectionId}
                onSelectSection={setSelectedSectionId}
                onToggleSection={(sectionId, enabled) =>
                  commit(updateSection(document, sectionId, { enabled }))
                }
                onDuplicate={(sectionId) =>
                  commit(duplicateSection(document, sectionId))
                }
                onDelete={handleDelete}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <AnnouncementNode
        selected={selectedSectionId === ANNOUNCEMENT_SELECTION_ID}
        enabled={document.announcement.enabled}
        onSelect={() => setSelectedSectionId(ANNOUNCEMENT_SELECTION_ID)}
      />
    </div>
  );
}

function SortableSectionRow({
  section,
  index,
  selected,
  onSelectSection,
  onToggleSection,
  onDuplicate,
  onDelete,
}: {
  section: HomepageSection;
  index: number;
  selected: boolean;
  onSelectSection: (sectionId: string) => void;
  onToggleSection: (sectionId: string, enabled: boolean) => void;
  onDuplicate: (sectionId: string) => void;
  onDelete: (section: HomepageSection, index: number) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });
  const addable = ADDABLE_SECTION_TYPES.has(section.type);

  return (
    <li
      ref={setNodeRef}
      data-section-row={section.id}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        transition: transition ?? undefined,
      }}
      className={`rounded-lg border bg-card ${
        isDragging ? "border-cta shadow-sm" : "border-border"
      }`}
    >
      <div className="flex items-center gap-0.5 p-1">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t("homepage_builder_section_drag")}
          className="cursor-grab touch-none rounded px-1.5 py-1 text-sm text-ink-muted hover:text-cta active:cursor-grabbing"
        >
          ⠿
        </button>
        <button
          type="button"
          onClick={() => onSelectSection(section.id)}
          aria-pressed={selected}
          className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm transition-colors ${
            selected ? "text-cta" : "text-ink hover:text-cta"
          }`}
        >
          {section.title ?? section.type}
        </button>
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-cta"
          checked={section.enabled}
          aria-label={t(
            section.enabled
              ? "homepage_builder_section_hide"
              : "homepage_builder_section_show",
          )}
          onChange={(event) => onToggleSection(section.id, event.target.checked)}
        />
        {addable ? (
          <>
            <button
              type="button"
              aria-label={t("homepage_builder_section_duplicate")}
              onClick={() => onDuplicate(section.id)}
              className="rounded px-1.5 py-1 text-sm text-ink-muted hover:text-cta"
            >
              ⧉
            </button>
            <button
              type="button"
              aria-label={t("homepage_builder_section_delete")}
              onClick={() => onDelete(section, index)}
              className="rounded px-1.5 py-1 text-sm text-ink-muted hover:text-sale"
            >
              ✕
            </button>
          </>
        ) : null}
      </div>

      {/* Ledger Ruling 30: the selected HERO expands into the Task 14 slide
          list (add/duplicate/delete/reorder live there). */}
      {section.type === "HERO" && selected ? (
        <SlideList sectionId={section.id} />
      ) : null}
    </li>
  );
}

function AnnouncementNode({
  selected,
  enabled,
  onSelect,
}: {
  selected: boolean;
  enabled: boolean;
  onSelect: () => void;
}): ReactNode {
  const { t } = useAdminI18n();
  return (
    <button
      type="button"
      data-announcement-node
      onClick={onSelect}
      aria-pressed={selected}
      className={`mt-auto flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? "border-cta text-cta"
          : "border-border text-ink hover:border-cta/60"
      }`}
    >
      <span className="truncate">
        {t("homepage_builder_announcement_title")}
      </span>
      <span
        className={`shrink-0 text-xs ${
          enabled ? "text-admin-success" : "text-ink-muted"
        }`}
      >
        {t(
          enabled
            ? "homepage_builder_status_enabled"
            : "homepage_builder_status_disabled",
        )}
      </span>
    </button>
  );
}
