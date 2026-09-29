"use client";

import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  SECTION_TYPES,
  type AddableSectionType,
} from "@/lib/homepage-section-factory";

export const ADD_SECTION_OPTIONS = [
  {
    type: "USP",
    labelKey: "homepage_builder_section_type_USP",
    descriptionKey: "homepage_builder_section_description_USP",
  },
  {
    type: "CATEGORY_TILES",
    labelKey: "homepage_builder_section_type_CATEGORY_TILES",
    descriptionKey: "homepage_builder_section_description_CATEGORY_TILES",
  },
  {
    type: "PRODUCT_GRID",
    labelKey: "homepage_builder_section_type_PRODUCT_GRID",
    descriptionKey: "homepage_builder_section_description_PRODUCT_GRID",
  },
  {
    type: "SOLUTIONS",
    labelKey: "homepage_builder_section_type_SOLUTIONS",
    descriptionKey: "homepage_builder_section_description_SOLUTIONS",
  },
  {
    type: "PRODUCT_STORY",
    labelKey: "homepage_builder_section_type_PRODUCT_STORY",
    descriptionKey: "homepage_builder_section_description_PRODUCT_STORY",
  },
  {
    type: "ROOM_INSPIRATION",
    labelKey: "homepage_builder_section_type_ROOM_INSPIRATION",
    descriptionKey: "homepage_builder_section_description_ROOM_INSPIRATION",
  },
  {
    type: "UGC",
    labelKey: "homepage_builder_section_type_UGC",
    descriptionKey: "homepage_builder_section_description_UGC",
  },
  {
    type: "BRAND_STORY",
    labelKey: "homepage_builder_section_type_BRAND_STORY",
    descriptionKey: "homepage_builder_section_description_BRAND_STORY",
  },
  {
    type: "CONFIDENCE",
    labelKey: "homepage_builder_section_type_CONFIDENCE",
    descriptionKey: "homepage_builder_section_description_CONFIDENCE",
  },
] as const satisfies ReadonlyArray<{
  type: AddableSectionType;
  labelKey: TKey;
  descriptionKey: TKey;
}>;

export function sectionTypeLabelKey(
  type: AddableSectionType,
): TKey {
  const option = ADD_SECTION_OPTIONS.find((candidate) => candidate.type === type);
  if (!option) {
    throw new Error(`Unknown addable section type: ${type}`);
  }
  return option.labelKey;
}

export function AddSectionDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (type: AddableSectionType) => void;
}): React.ReactNode {
  const { t } = useAdminI18n();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("homepage_builder_add_section_title")}
      width="md"
    >
      <div className="grid gap-2" data-add-section-options>
        {SECTION_TYPES.map((type) => {
          const option = ADD_SECTION_OPTIONS.find(
            (candidate) => candidate.type === type,
          );
          if (!option) return null;
          const descriptionId = `add-section-description-${type}`;
          return (
            <button
              key={type}
              type="button"
              data-section-type={type}
              aria-label={t(option.labelKey)}
              aria-describedby={descriptionId}
              onClick={() => onSelect(type)}
              className="flex min-w-0 flex-col items-start gap-0.5 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:border-cta hover:bg-primary-light/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
            >
              <span className="font-semibold text-ink">{t(option.labelKey)}</span>
              <span
                id={descriptionId}
                className="text-xs text-ink-secondary"
              >
                {t(option.descriptionKey)}
              </span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
