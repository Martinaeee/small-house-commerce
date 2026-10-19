"use client";

import { useEffect, useRef, useState } from "react";
import { adminApi, type AdminCategoryNode } from "@/lib/admin-api";
import { useAdminI18n } from "@/lib/admin-i18n";
import { newUuid } from "@/lib/homepage-document";
import type { HomepageNavigationEntry } from "@/lib/homepage-section-payloads";
import { readCategoryTilesPayload } from "@/lib/homepage-section-normalize";
import type { SectionPayloadEditorProps } from "../section-editor-registry";
import { BufferedImageUrlInput, BufferedTextInput } from "../BufferedSectionField";
import { LinkPicker } from "../LinkPicker";

export function HomepageNavigationEntriesEditor({ section, onPayloadChange }: SectionPayloadEditorProps<"CATEGORY_TILES">) {
  const { t } = useAdminI18n();
  const active = useRef(false);
  const [coverStatus, setCoverStatus] = useState<{ entryId: string; message: string } | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const entries = readCategoryTilesPayload(section.payload).entries ?? [];

  const updateEntry = (entryId: string, patch: Partial<HomepageNavigationEntry>) => {
    if (!active.current) return;
    onPayloadChange((payload) => {
      const index = payload.entries?.findIndex((entry) => entry.id === entryId) ?? -1;
      if (index < 0 || !payload.entries) return payload;
      const next = [...payload.entries];
      next[index] = { ...next[index], ...patch };
      return { ...payload, entries: next };
    });
  };

  const addEntry = () => {
    const entry = { id: newUuid(), link: null };
    onPayloadChange((payload) => {
      if (!payload.entries || payload.entries.length >= 6) return payload;
      return { ...payload, entries: [...payload.entries, entry] };
    });
  };

  const moveEntry = (entryId: string, delta: -1 | 1) => {
    onPayloadChange((payload) => {
      const next = [...(payload.entries ?? [])];
      const from = next.findIndex((entry) => entry.id === entryId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= next.length) return payload;
      [next[from], next[to]] = [next[to], next[from]];
      return { ...payload, entries: next };
    });
  };

  const removeEntry = (entryId: string) => {
    onPayloadChange((payload) => {
      if (!payload.entries?.some((entry) => entry.id === entryId)) return payload;
      return { ...payload, entries: payload.entries.filter((entry) => entry.id !== entryId) };
    });
  };

  const applyCategoryCover = async (entry: HomepageNavigationEntry) => {
    if (entry.link?.type !== "CATEGORY") return;
    const categoryId = entry.link.id;
    setCoverStatus(null);
    try {
      const nodes = await adminApi.listCategories();
      if (!active.current) return;
      const find = (rows: AdminCategoryNode[]): AdminCategoryNode | undefined => {
        for (const row of rows) {
          if (row.id === categoryId) return row;
          const child = find(row.children ?? []);
          if (child) return child;
        }
      };
      const category = find(nodes);
      if (category?.status !== "ACTIVE" || !category.imageUrl) {
        setCoverStatus({ entryId: entry.id, message: t("homepage_builder_navigation_no_cover") });
        return;
      }
      onPayloadChange((payload) => {
        const current = payload.entries?.find((row) => row.id === entry.id);
        if (!current || current.link?.type !== "CATEGORY" || current.link.id !== categoryId || current.imageUrl !== entry.imageUrl) return payload;
        return { ...payload, entries: payload.entries!.map((row) => row.id === entry.id ? { ...row, imageUrl: category.imageUrl! } : row) };
      });
    } catch {
      if (active.current) setCoverStatus({ entryId: entry.id, message: t("homepage_builder_navigation_cover_failed") });
    }
  };

  return (
    <section data-section-content-editor="CATEGORY_TILES" className="flex min-w-0 flex-col gap-4">
      <p className="text-sm leading-relaxed text-ink-muted">{t("homepage_builder_navigation_limit")}</p>
      {entries.map((entry, index) => (
        <section key={entry.id} id={`homepage-entry-${entry.id}`} data-homepage-entry-id={entry.id} data-entry-id={entry.id}
          aria-label={t("homepage_builder_navigation_entry", { index: index + 1 })}
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-semibold">{t("homepage_builder_navigation_entry", { index: index + 1 })}</h3>
            <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40" disabled={index === 0}
              aria-label={t("homepage_builder_navigation_up", { index: index + 1 })} onClick={() => moveEntry(entry.id, -1)}>{t("homepage_builder_move_up")}</button>
            <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40" disabled={index === entries.length - 1}
              aria-label={t("homepage_builder_navigation_down", { index: index + 1 })} onClick={() => moveEntry(entry.id, 1)}>{t("homepage_builder_move_down")}</button>
            <button type="button" className="min-h-11 rounded-lg px-3 text-sm text-sale"
              aria-label={t("homepage_builder_navigation_remove", { index: index + 1 })} onClick={() => removeEntry(entry.id)}>{t("homepage_builder_navigation_delete")}</button>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`navigation-image-${section.id}-${entry.id}`} className="text-sm font-medium">{t("homepage_builder_navigation_image", { index: index + 1 })}</label>
            <BufferedImageUrlInput id={`navigation-image-${section.id}-${entry.id}`} ariaLabel={t("homepage_builder_navigation_image", { index: index + 1 })}
              value={entry.imageUrl ?? ""} isValid={(value) => value === "" || (value.length <= 2048 && (/^https?:\/\/.+/i.test(value) || (value.startsWith("/") && !value.startsWith("//") && value.length > 1)))}
              onCommit={(value) => updateEntry(entry.id, { imageUrl: value || undefined })}
              labels={{ upload: t("homepage_builder_media_upload_image"), uploading: t("homepage_builder_media_uploading"), invalidType: t("homepage_builder_media_image_invalid"), tooLarge: t("homepage_builder_media_image_too_large"), uploadFailed: t("homepage_builder_media_upload_failed") }} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5" role="group" aria-label={t("homepage_builder_navigation_target")}>
            <span className="text-sm font-medium">{t("homepage_builder_navigation_target")}</span>
            <LinkPicker value={entry.link} allowExternal={false} entityTypes={["CATEGORY", "COLLECTION"]} onChange={(link) => {
              if (link === null) {
                setCoverStatus(null);
                updateEntry(entry.id, { link: null });
                return;
              }
              const type = link.type;
              if (type !== "CATEGORY" && type !== "COLLECTION") return;
              setCoverStatus(null);
              updateEntry(entry.id, { link: { type, id: link.id } });
            }} />
          </div>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">{t("homepage_builder_navigation_name")}
            <BufferedTextInput className="min-h-11 min-w-0 rounded-lg border border-border bg-card px-3 font-normal" maxLength={120}
              value={entry.label ?? ""} onCommit={(label) => updateEntry(entry.id, { label: label || undefined })} />
          </label>
          {entry.link?.type === "CATEGORY" ? <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-sm text-cta" onClick={() => void applyCategoryCover(entry)}>{t("homepage_builder_navigation_cover")}</button> : null}
          {coverStatus?.entryId === entry.id ? <p role="status" className="text-sm leading-relaxed text-ink-muted">{coverStatus.message}</p> : null}
        </section>
      ))}
      <button type="button" className="min-h-11 rounded-xl border border-cta/40 px-4 text-sm font-semibold text-cta disabled:opacity-40"
        disabled={entries.length >= 6} onClick={addEntry}>{t("homepage_builder_navigation_add")}</button>
    </section>
  );
}
