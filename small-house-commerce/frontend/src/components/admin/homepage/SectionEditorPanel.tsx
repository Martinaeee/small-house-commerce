"use client";

import type { ReactNode } from "react";
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
): ReactNode {
  const Editor = definition.editor;
  return <Editor section={section} onPayloadChange={onPayloadChange} />;
}

export function SectionEditorPanel({
  sectionId,
}: {
  sectionId: string;
}): ReactNode {
  const { t } = useAdminI18n();
  const { state, dispatch } = useHomepageEditor();
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

  return (
    <div
      data-testid="section-editor-panel"
      data-section-editor-type={section.type}
      className="flex min-h-[320px] flex-col gap-3 rounded-xl border border-border bg-card p-4"
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
      <SectionStyleFields section={section} onChange={applyStylePatch} />
      {renderPayloadEditor()}
    </div>
  );
}
