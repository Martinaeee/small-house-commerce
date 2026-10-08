"use client";

import { useCallback, useMemo, type ReactNode } from "react";
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
import { useBufferedText } from "@/components/admin/homepage/AnnouncementSettings";
import {
  addHeroSlide,
  duplicateHeroSlide,
  moveHeroSlide,
  removeHeroSlide,
  updateHeroSlide,
  type HeroSlide,
  type HomepageDocument,
  type HomepageSection,
} from "@/lib/homepage-document";

/**
 * Left pane, nested under the selected HERO section (ledger Ruling 30): the
 * slide cards for `payload.slides` — two-digit index, editable name, enabled
 * switch, media thumbnail, schedule badge, drag sorting with a keyboard
 * sensor, duplicate/delete, an up/down fallback and `+ Add slide`.
 *
 * Add/duplicate/delete/reorder live here (Task 13 deliberately deferred them);
 * every mutation goes through the Task 8 slide mutators. The name field
 * buffers locally and commits once per typing burst (300 ms) or on blur
 * through the race-safe `mutate` action.
 *
 * Note: `addHeroSlide`/`moveHeroSlide` are the index-only Task 8 APIs and
 * always target the first HERO. The editor never creates a second HERO
 * (the module tree only duplicates addable section types), so this is the
 * same section the tree renders here.
 */

/** Backend cap on `payload.slides` (heroPayloadSchema). */
export const MAX_HERO_SLIDES = 6;

type HeroSection = Extract<HomepageSection, { type: "HERO" }>;

function heroSectionById(
  document: HomepageDocument,
  sectionId: string,
): HeroSection | null {
  for (const section of document.sections) {
    if (section.type === "HERO" && section.id === sectionId) return section;
  }
  return null;
}

/** IMAGE slides show their image; VIDEO slides show their poster. */
function thumbnailUrl(slide: HeroSlide): string | null {
  const media = slide.media;
  if (!media) return null;
  if (media.type === "IMAGE") return media.image?.url ?? null;
  return media.video?.poster ?? null;
}

function hasConfiguredMedia(slide: HeroSlide): boolean {
  const media = slide.media;
  if (!media) return false;
  if (media.type === "IMAGE") return Boolean(media.image?.url.trim());
  return Boolean(media.video?.url.trim());
}

export function SlideList({ sectionId }: { sectionId: string }): ReactNode {
  const { t } = useAdminI18n();
  const {
    state,
    dispatch,
    selectedSlideId,
    setSelectedSlideId,
    setSelectedSectionId,
    setSelectedElementKey,
  } = useHomepageEditor();
  const document = state.document;
  const section = heroSectionById(document, sectionId);

  const commit = useCallback(
    (next: HomepageDocument): void => {
      dispatch({ type: "commit", document: next });
    },
    [dispatch],
  );

  const selectSlide = useCallback(
    (slideId: string): void => {
      setSelectedSectionId(sectionId);
      setSelectedElementKey(null);
      setSelectedSlideId(slideId);
    },
    [sectionId, setSelectedElementKey, setSelectedSectionId, setSelectedSlideId],
  );

  const slides = useMemo(
    () =>
      section
        ? [...section.payload.slides].sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [section],
  );
  const slideIds = useMemo(
    () => slides.map((slide) => slide.id),
    [slides],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = slideIds.indexOf(String(active.id));
      const to = slideIds.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      commit(moveHeroSlide(document, from, to));
    },
    [commit, document, slideIds],
  );

  if (!section) return null;

  return (
    <div
      data-panel="slide-list"
      className="flex flex-col gap-2 border-t border-border px-1.5 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-secondary">
          {t("homepage_builder_slides_header")}
        </span>
        <button
          type="button"
          className="rounded-lg border border-cta/40 px-2 py-1 text-xs font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          disabled={slides.length >= MAX_HERO_SLIDES}
          onClick={() => commit(addHeroSlide(document))}
        >
          {t("homepage_builder_slide_add")}
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={slideIds}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-1.5">
            {slides.map((slide, index) => (
              <SortableSlideCard
                key={slide.id}
                document={document}
                slide={slide}
                index={index}
                count={slides.length}
                selected={slide.id === selectedSlideId}
                onSelect={selectSlide}
                commit={commit}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableSlideCard({
  document,
  slide,
  index,
  count,
  selected,
  onSelect,
  commit,
}: {
  document: HomepageDocument;
  slide: HeroSlide;
  index: number;
  count: number;
  selected: boolean;
  onSelect: (slideId: string) => void;
  commit: (next: HomepageDocument) => void;
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
  } = useSortable({ id: slide.id });

  const name = useBufferedText(slide.name, (current, next) =>
    updateHeroSlide(current, slide.id, { name: next }),
  );

  const thumbnail = thumbnailUrl(slide);
  const configuredMedia = hasConfiguredMedia(slide);
  const mediaActionKey = configuredMedia
    ? "homepage_builder_slide_replace_media"
    : "homepage_builder_slide_add_media";
  const scheduled =
    slide.schedule.publishAt !== null || slide.schedule.unpublishAt !== null;
  const deleteBlocked = count <= 1;

  return (
    <li
      ref={setNodeRef}
      data-slide-card={slide.id}
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
          className="cursor-grab touch-none rounded px-1 py-1 text-sm text-ink-muted hover:text-cta active:cursor-grabbing"
        >
          ⠿
        </button>
        <button
          type="button"
          onClick={() => onSelect(slide.id)}
          aria-pressed={selected}
          aria-label={slide.name}
          className={`shrink-0 rounded px-1 py-1 text-xs tabular-nums transition-colors ${
            selected ? "text-cta" : "text-ink-muted hover:text-cta"
          }`}
        >
          <span data-slide-index>
            {String(index + 1).padStart(2, "0")}
          </span>
        </button>
        <input
          type="text"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink hover:border-border focus:border-cta focus:outline-none"
          maxLength={80}
          aria-label={t("homepage_builder_slide_name")}
          value={name.value}
          onChange={(event) => name.change(event.target.value)}
          onBlur={name.blur}
        />
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-cta"
          checked={slide.enabled}
          aria-label={t("homepage_builder_slide_enabled")}
          onChange={(event) =>
            commit(
              updateHeroSlide(document, slide.id, {
                enabled: event.target.checked,
              }),
            )
          }
        />
        <button
          type="button"
          className="rounded px-1 py-1 text-sm text-ink-muted hover:text-cta disabled:cursor-not-allowed disabled:text-ink-muted/50"
          aria-label={t("homepage_builder_move_up")}
          disabled={index === 0}
          onClick={() => commit(moveHeroSlide(document, index, index - 1))}
        >
          ↑
        </button>
        <button
          type="button"
          className="rounded px-1 py-1 text-sm text-ink-muted hover:text-cta disabled:cursor-not-allowed disabled:text-ink-muted/50"
          aria-label={t("homepage_builder_move_down")}
          disabled={index === count - 1}
          onClick={() => commit(moveHeroSlide(document, index, index + 1))}
        >
          ↓
        </button>
        <button
          type="button"
          className="rounded px-1 py-1 text-sm text-ink-muted hover:text-cta"
          aria-label={t("homepage_builder_slide_duplicate")}
          onClick={() => commit(duplicateHeroSlide(document, slide.id))}
        >
          ⧉
        </button>
        <button
          type="button"
          className="rounded px-1 py-1 text-sm text-ink-muted hover:text-sale disabled:cursor-not-allowed disabled:text-ink-muted/50"
          aria-label={t("homepage_builder_slide_delete")}
          title={
            deleteBlocked
              ? t("homepage_builder_slide_delete_last_blocked")
              : undefined
          }
          disabled={deleteBlocked}
          onClick={() => commit(removeHeroSlide(document, slide.id))}
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-2 px-1.5 pb-1.5 pl-8">
        <button
          type="button"
          aria-label={`${slide.name}: ${t(mediaActionKey)}`}
          aria-pressed={selected}
          onClick={() => onSelect(slide.id)}
          className={`group relative h-10 w-16 shrink-0 overflow-hidden rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-1 ${
            selected
              ? "border-cta ring-1 ring-cta"
              : "border-border hover:border-cta"
          }`}
        >
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin-only external media thumbs; no optimizer domain allowlist.
            <img
              src={thumbnail}
              alt={slide.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center border border-dashed border-border text-[10px] text-ink-muted">
              {configuredMedia && slide.media?.type === "VIDEO"
                ? t("homepage_builder_media_video")
                : t("homepage_builder_slide_no_media")}
            </span>
          )}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 px-1 text-center text-[9px] font-semibold leading-tight text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {t(mediaActionKey)}
          </span>
        </button>
        {scheduled ? (
          <span className="rounded-full bg-admin-warning-soft px-2 py-0.5 text-[10px] font-semibold text-ink-secondary">
            {t("homepage_builder_slide_scheduled")}
          </span>
        ) : null}
      </div>
    </li>
  );
}
