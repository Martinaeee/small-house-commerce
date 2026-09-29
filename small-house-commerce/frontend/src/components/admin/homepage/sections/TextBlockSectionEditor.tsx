"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { TextBlockPayload } from "@/lib/homepage-section-payloads";
import type {
  SectionOf,
} from "@/components/admin/homepage/section-editor-registry";

const MAX_BULLETS = 6;
type TextBlockSection = SectionOf<"BRAND_STORY"> | SectionOf<"CONFIDENCE">;
type TextBlockEditorProps = {
  section: TextBlockSection;
  onPayloadChange: (
    patch:
      | Partial<TextBlockPayload>
      | ((payload: TextBlockPayload) => TextBlockPayload),
  ) => void;
};

function newRowId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ? `bullet-${random}` : `bullet-${Date.now()}-${Math.random()}`;
}

function safeBullets(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((bullet): bullet is string => typeof bullet === "string").slice(0, MAX_BULLETS)
    : [];
}

function safePayload(value: unknown): TextBlockPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as TextBlockPayload)
    : {};
}

export function TextBlockSectionEditor({
  section,
  onPayloadChange,
}: TextBlockEditorProps): ReactNode {
  const { t } = useAdminI18n();
  const payload = safePayload(section.payload);
  const bullets = safeBullets(payload.bullets);
  const snapshotSignature = `${section.id}:${JSON.stringify(bullets)}:${typeof payload.heading === "string" ? payload.heading : ""}:${typeof payload.body === "string" ? payload.body : ""}`;
  const localSnapshotSignature = useRef(snapshotSignature);
  const [rowIds, setRowIds] = useState<string[]>(() => bullets.map(() => newRowId()));
  const visibleRowIds = bullets.map(
    (_, index) => rowIds[index] ?? `bullet-${section.id}-${index}`,
  );

  useEffect(() => {
    if (snapshotSignature === localSnapshotSignature.current) return;
    localSnapshotSignature.current = snapshotSignature;
    setRowIds(bullets.map(() => newRowId()));
  }, [bullets, section.id, snapshotSignature]);

  const updateField = (field: "heading" | "body", value: string): void => {
    onPayloadChange((current) => {
      const next = { ...current } as Record<string, unknown>;
      if (value === "") delete next[field];
      else next[field] = value;
      return next as TextBlockPayload;
    });
  };

  const updateBullet = (rowId: string, value: string): void => {
    onPayloadChange((current) => {
      const currentBullets = safeBullets(current.bullets);
      const index = visibleRowIds.indexOf(rowId);
      if (index < 0 || index >= currentBullets.length) return current;
      const nextBullets = currentBullets.map((bullet, bulletIndex) =>
        bulletIndex === index ? value : bullet,
      );
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextBullets)}:${typeof current.heading === "string" ? current.heading : ""}:${typeof current.body === "string" ? current.body : ""}`;
      return { ...current, bullets: nextBullets };
    });
  };

  const addBullet = (): void => {
    const nextRowId = newRowId();
    onPayloadChange((current) => {
      const currentBullets = safeBullets(current.bullets);
      if (currentBullets.length >= MAX_BULLETS) return current;
      const nextBullets = [...currentBullets, ""];
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextBullets)}:${typeof current.heading === "string" ? current.heading : ""}:${typeof current.body === "string" ? current.body : ""}`;
      return { ...current, bullets: nextBullets };
    });
    if (bullets.length < MAX_BULLETS) setRowIds((current) => [...current, nextRowId]);
  };

  const removeBullet = (rowId: string): void => {
    onPayloadChange((current) => {
      const currentBullets = safeBullets(current.bullets);
      const index = visibleRowIds.indexOf(rowId);
      if (index < 0) return current;
      const nextBullets = currentBullets.filter((_, bulletIndex) => bulletIndex !== index);
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextBullets)}:${typeof current.heading === "string" ? current.heading : ""}:${typeof current.body === "string" ? current.body : ""}`;
      return { ...current, bullets: nextBullets };
    });
    setRowIds((current) => current.filter((id) => id !== rowId));
  };

  return (
    <section
      data-section-content-editor={section.type}
      data-testid="section-content-editor-type"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <span className="sr-only">{section.type}</span>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_text_block_heading")}
        <input
          type="text"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_text_block_heading")}
          maxLength={120}
          value={typeof payload.heading === "string" ? payload.heading : ""}
          onChange={(event) => updateField("heading", event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_text_block_body")}
        <textarea
          className="min-h-24 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_text_block_body")}
          maxLength={3000}
          value={typeof payload.body === "string" ? payload.body : ""}
          onChange={(event) => updateField("body", event.target.value)}
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_text_block_bullets")}</h2>
          <p className="text-xs text-ink-muted">{t("homepage_builder_text_block_limit", { max: MAX_BULLETS })}</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-cta/40 px-3 py-1.5 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          disabled={bullets.length >= MAX_BULLETS}
          onClick={addBullet}
        >
          {t("homepage_builder_text_block_add")}
        </button>
      </div>

      {bullets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-ink-muted">
          {t("homepage_builder_text_block_empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {bullets.map((bullet, index) => {
            const rowId = visibleRowIds[index];
            return (
              <div key={rowId} className="flex items-start gap-2 rounded-lg border border-border p-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-ink-secondary">
                  {t("homepage_builder_text_block_row", { index: index + 1 })}
                  <input
                    type="text"
                    className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    aria-label={t("homepage_builder_text_block_row", { index: index + 1 })}
                    maxLength={200}
                    value={bullet}
                    onChange={(event) => updateBullet(rowId, event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="mt-5 rounded px-2 py-1 text-xs text-sale hover:bg-sale/10"
                  aria-label={t("homepage_builder_text_block_remove", { index: index + 1 })}
                  onClick={() => removeBullet(rowId)}
                >
                  {t("homepage_builder_text_block_remove", { index: index + 1 })}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
