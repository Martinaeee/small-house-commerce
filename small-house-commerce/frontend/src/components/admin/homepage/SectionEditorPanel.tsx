"use client";

import { useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  updateSection,
  type HomepageSection,
  type NonHeroHomepageSection,
} from "@/lib/homepage-document";
import { updateSectionPayload } from "@/lib/homepage-section-factory";
import { normalizeSectionForEditor } from "@/lib/homepage-section-normalize";
import type {
  NonHeroSectionType,
  SectionPayloadMap,
} from "@/lib/homepage-section-payloads";
import type { SectionProduct } from "@/lib/homepage-document";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";
import {
  SECTION_EDITOR_REGISTRY,
  getSectionEditorDefinition,
  type SectionEditorDefinition,
  type SectionOf,
  type SectionPayloadEditorProps,
} from "@/components/admin/homepage/section-editor-registry";
import {
  SectionCommonFields,
  type SectionCommonPatch,
} from "@/components/admin/homepage/SectionCommonFields";
import {
  SectionStyleFields,
  readSectionStyle,
  type SectionStylePatch,
} from "@/components/admin/homepage/SectionStyleFields";

function nonHeroSection(
  section: HomepageSection | undefined,
): NonHeroHomepageSection | null {
  if (!section || section.type === "HERO") return null;
  return normalizeSectionForEditor(section) as NonHeroHomepageSection;
}

function renderSectionEditor<T extends NonHeroSectionType>(
  definition: SectionEditorDefinition<T>,
  section: SectionOf<T>,
  onPayloadChange: SectionPayloadEditorProps<T>["onPayloadChange"],
  onProductsChange?: SectionPayloadEditorProps<T>["onProductsChange"],
): ReactNode {
  const Editor = definition.editor;
  return (
    <Editor
      section={section}
      onPayloadChange={onPayloadChange}
      onProductsChange={onProductsChange}
    />
  );
}

export function SectionEditorPanel({
  sectionId,
}: {
  sectionId: string;
}): ReactNode {
  const { t } = useAdminI18n();
  const { state, dispatch } = useHomepageEditor();
  const [styleOpen, setStyleOpen] = useState(false);
  const section = nonHeroSection(
    state.document.sections.find((candidate) => candidate.id === sectionId),
  );

  if (!section) return null;

  const definition = getSectionEditorDefinition(section.type);

  const applyCommonPatch = (patch: SectionCommonPatch): void => {
    dispatch({
      type: "mutate",
      mutate: (document) => {
        const target = document.sections.find(({ id }) => id === sectionId);
        if (!target || target.type === "HERO") return document;
        const { schedule, ...fields } = patch;
        return updateSection(document, sectionId, {
          ...fields,
          ...(schedule
            ? { schedule: { ...target.schedule, ...schedule } }
            : {}),
        });
      },
    });
  };

  function applyPayloadPatch<T extends NonHeroSectionType>(
    type: T,
    patch:
      | Partial<SectionPayloadMap[T]>
      | ((payload: SectionPayloadMap[T]) => SectionPayloadMap[T]),
  ): void {
    dispatch({
      type: "mutate",
      mutate: (document) =>
        updateSectionPayload(document, sectionId, type, (payload) =>
          typeof patch === "function"
            ? patch(payload)
            : { ...payload, ...patch },
        ),
    });
  }

  function applyProductsPatch(
    patch: SectionProduct[] | ((products: SectionProduct[]) => SectionProduct[]),
  ): void {
    dispatch({
      type: "mutate",
      mutate: (document) => {
        const next = structuredClone(document);
        const target = next.sections.find((candidate) => candidate.id === sectionId);
        if (!target || target.type !== "PRODUCT_GRID") return document;
        const products = [...(Array.isArray(target.products) ? target.products : [])].sort(
          (left, right) => left.sortOrder - right.sortOrder,
        );
        const updated = typeof patch === "function" ? patch(products) : patch;
        target.products = structuredClone(updated).map((product, index) => ({
          ...product,
          sortOrder: index,
        }));
        return next;
      },
    });
  }

  const renderPayloadEditor = (): ReactNode => {
    switch (section.type) {
      case "USP":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.USP,
          section,
          (patch) => applyPayloadPatch("USP", patch),
        );
      case "CATEGORY_TILES":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.CATEGORY_TILES,
          section,
          (patch) => applyPayloadPatch("CATEGORY_TILES", patch),
        );
      case "PRODUCT_GRID":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.PRODUCT_GRID,
          section,
          (patch) => applyPayloadPatch("PRODUCT_GRID", patch),
          applyProductsPatch,
        );
      case "SOLUTIONS":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.SOLUTIONS,
          section,
          (patch) => applyPayloadPatch("SOLUTIONS", patch),
        );
      case "PRODUCT_STORY":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.PRODUCT_STORY,
          section,
          (patch) => applyPayloadPatch("PRODUCT_STORY", patch),
        );
      case "ROOM_INSPIRATION":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.ROOM_INSPIRATION,
          section,
          (patch) => applyPayloadPatch("ROOM_INSPIRATION", patch),
        );
      case "UGC":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.UGC,
          section,
          (patch) => applyPayloadPatch("UGC", patch),
        );
      case "BRAND_STORY":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.BRAND_STORY,
          section,
          (patch) => applyPayloadPatch("BRAND_STORY", patch),
        );
      case "CONFIDENCE":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.CONFIDENCE,
          section,
          (patch) => applyPayloadPatch("CONFIDENCE", patch),
        );
      case "PROMO_BANNER":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.PROMO_BANNER,
          section,
          (patch) => applyPayloadPatch("PROMO_BANNER", patch),
        );
      case "COUNTDOWN_BANNER":
        return renderSectionEditor(
          SECTION_EDITOR_REGISTRY.COUNTDOWN_BANNER,
          section,
          (patch) => applyPayloadPatch("COUNTDOWN_BANNER", patch),
        );
    }
  };

  const applyStylePatch = (patch: SectionStylePatch): void => {
    dispatch({
      type: "mutate",
      mutate: (document) => {
        const next = structuredClone(document);
        const target = next.sections.find((candidate) => candidate.id === sectionId);
        if (!target || target.type === "HERO") return document;
        const style =
          target.style && typeof target.style === "object" && !Array.isArray(target.style)
            ? { ...target.style }
            : {};
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value === "") delete style[key];
          else style[key] = value;
        }
        target.style = Object.keys(style).length > 0 ? style : undefined;
        return next;
      },
    });
  };

  const style = readSectionStyle(section.style);
  const overrideCount = Object.keys(style).length;

  return (
    <div
      data-testid="section-editor-panel"
      data-section-editor-type={section.type}
      className="flex min-w-0 min-h-[320px] flex-col gap-3 overflow-x-hidden rounded-xl border border-border bg-card p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">
          {t(definition.labelKey)}
        </h2>
        <p className="text-xs leading-relaxed text-ink-muted">
          {t(definition.descriptionKey)}
        </p>
        <span data-testid="section-editor-type" className="sr-only">
          {section.type}
        </span>
      </header>

      <SectionCommonFields section={section} onChange={applyCommonPatch} />
      <div
        data-panel="section-style-override"
        className="flex min-w-0 flex-col gap-2"
      >
        <button
          type="button"
          data-style-override-toggle
          aria-expanded={styleOpen}
          onClick={() => setStyleOpen((open) => !open)}
          className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm font-semibold text-ink transition-colors hover:border-cta/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
        >
          <span className="truncate">
            {t("homepage_builder_style_override_group")}
          </span>
          <span className="shrink-0 text-xs font-normal text-ink-muted">
            {overrideCount > 0
              ? t("homepage_builder_style_override_count", { count: overrideCount })
              : t("homepage_builder_style_override_inherited")}
          </span>
        </button>
        {styleOpen ? (
          <SectionStyleFields value={style} onChange={applyStylePatch} />
        ) : null}
      </div>
      {renderPayloadEditor()}
    </div>
  );
}
