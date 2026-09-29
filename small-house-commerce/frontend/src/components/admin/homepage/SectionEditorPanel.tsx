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
  type SectionEditorComponent,
  type SectionOf,
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

  const definition = SECTION_EDITOR_REGISTRY[section.type];
  const Editor = definition.editor as SectionEditorComponent<NonHeroSectionType>;
  const typedSection = section as SectionOf<NonHeroSectionType>;

  const applyCommonPatch = (patch: SectionCommonPatch): void => {
    dispatch({
      type: "mutate",
      mutate: (document) => updateSection(document, sectionId, patch),
    });
  };

  const applyPayloadPatch = (
    patch:
      | Partial<SectionPayloadMap[NonHeroSectionType]>
      | ((payload: SectionPayloadMap[NonHeroSectionType]) => SectionPayloadMap[NonHeroSectionType]),
  ): void => {
    dispatch({
      type: "mutate",
      mutate: (document) =>
        updateSectionPayload(
          document,
          sectionId,
          section.type,
          (payload) => {
            const next =
              typeof patch === "function"
                ? patch(payload as SectionPayloadMap[typeof section.type])
                : { ...payload, ...patch };
            return next as SectionPayloadMap[typeof section.type];
          },
        ),
    });
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
      <Editor
        section={typedSection}
        onPayloadChange={applyPayloadPatch}
      />
    </div>
  );
}
