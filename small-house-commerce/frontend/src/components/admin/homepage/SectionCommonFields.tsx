"use client";

import type { ReactNode } from "react";
import { Field, TextInput } from "@/components/admin/Field";
import { useAdminI18n } from "@/lib/admin-i18n";
import { isoToLocalInput } from "@/lib/datetime-input";
import type { NonHeroHomepageSection, Schedule } from "@/lib/homepage-document";

export type SectionCommonPatch =
  Partial<Omit<Pick<NonHeroHomepageSection, "title" | "subtitle" | "enabled" | "schedule">, "schedule">> & {
    schedule?: Partial<Schedule>;
  };

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hasInvalidSchedule(schedule: Schedule): boolean {
  if (!schedule.publishAt || !schedule.unpublishAt) return false;
  return Date.parse(schedule.unpublishAt) <= Date.parse(schedule.publishAt);
}

export function SectionCommonFields({
  section,
  onChange,
}: {
  section: NonHeroHomepageSection;
  onChange: (patch: SectionCommonPatch) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const scheduleError = hasInvalidSchedule(section.schedule)
    ? t("homepage_builder_section_schedule_order_error")
    : undefined;
  const changeSchedule = (field: keyof Schedule, value: string): void => {
    onChange({
      schedule: {
        [field]: toIso(value),
      },
    });
  };

  return (
    <>
      <section
        data-panel="section-common-fields"
        className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-3"
      >
        <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_group_content")}</h2>
        <div className="grid min-w-0 gap-3">
          <Field label={t("homepage_builder_section_title")} htmlFor={`section-title-${section.id}`}>
            <TextInput
              className="text-sm py-2"
              id={`section-title-${section.id}`}
              aria-label={t("homepage_builder_section_title")}
              value={section.title ?? ""}
              maxLength={200}
              onChange={(event) => onChange({ title: event.target.value || null })}
            />
          </Field>
          <Field
            label={t("homepage_builder_section_subtitle")}
            htmlFor={`section-subtitle-${section.id}`}
          >
            <TextInput
              className="text-sm py-2"
              id={`section-subtitle-${section.id}`}
              aria-label={t("homepage_builder_section_subtitle")}
              value={section.subtitle ?? ""}
              maxLength={500}
              onChange={(event) => onChange({ subtitle: event.target.value || null })}
            />
          </Field>
        </div>
      </section>
      <section
        data-panel="section-advanced-fields"
        className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-3"
      >
        <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_group_advanced")}</h2>
        <label className="flex min-w-0 items-center gap-2 text-sm text-ink" htmlFor={`section-enabled-${section.id}`}>
          <input
            id={`section-enabled-${section.id}`}
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-cta"
            aria-label={t("homepage_builder_section_enabled")}
            checked={section.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          {t("homepage_builder_section_enabled")}
        </label>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label={t("homepage_builder_section_start")} htmlFor={`section-start-${section.id}`}>
            <TextInput
              className="text-sm py-2"
              id={`section-start-${section.id}`}
              type="datetime-local"
              aria-label={t("homepage_builder_section_start")}
              value={section.schedule.publishAt ? isoToLocalInput(section.schedule.publishAt) : ""}
              onChange={(event) => changeSchedule("publishAt", event.target.value)}
            />
          </Field>
          <Field
            label={t("homepage_builder_section_end")}
            htmlFor={`section-end-${section.id}`}
            error={scheduleError}
          >
            <TextInput
              className="text-sm py-2"
              id={`section-end-${section.id}`}
              type="datetime-local"
              aria-label={t("homepage_builder_section_end")}
              aria-invalid={scheduleError ? "true" : undefined}
              value={section.schedule.unpublishAt ? isoToLocalInput(section.schedule.unpublishAt) : ""}
              onChange={(event) => changeSchedule("unpublishAt", event.target.value)}
            />
          </Field>
        </div>
      </section>
    </>
  );
}
