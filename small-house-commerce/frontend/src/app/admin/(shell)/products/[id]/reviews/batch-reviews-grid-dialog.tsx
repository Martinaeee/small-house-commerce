"use client";

import { Fragment, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/admin/Dialog";
import { resolveUploadType } from "@/components/admin/ImageUrlInput";
import { AdminApiError } from "@/lib/admin-auth";
import {
  adminApi,
  type BatchLineError,
  type BatchReviewInput,
} from "@/lib/admin-api";
import { dateToLocalInput, nowLocalInput } from "@/lib/datetime-input";

/**
 * Spreadsheet-style batch review editor for one product:
 * - rows: 作者 / 地区 / 标题 / 评论 / 多图(上传或 URL) / 规格 / 时间 / 评分 / 显示
 * - TSV paste ("从表格粘贴") fills rows in one shot (Excel/Sheets columns)
 * - one atomic save (all rows or none); backend row/field errors pin cells
 */

const MAX_ROWS = 100;
const MAX_PHOTOS = 6;
const MAX_BYTES = 5 * 1024 * 1024;

// Column order mirrors createAdminReviewSchema (review.dto.ts).
const FORMAT_HINT =
  "每行一条，列之间用 Tab（可直接从 Excel/Google Sheets 整列粘贴）：姓名 ⇥ 地区(可空) ⇥ 星级1-5 ⇥ 标题(可空) ⇥ 评论 ⇥ 图片URL(可空，多张用 | 分隔) ⇥ 时间(可空，如 2026-08-01 或 2026-08-01 14:30，留空=当前时间) ⇥ 规格(可空，如 Color: Walnut Brown | Size: S)";
const EXAMPLE_LINE =
  "Maria Santos\tManila\t5\tSturdy shelf\tEasy to assemble and holds our books.\thttps://example.com/a.jpg|https://example.com/b.jpg\t2026-08-01 14:30\tColor: Walnut Brown | Size: S";

const FIELD_LABELS: Record<string, string> = {
  authorName: "作者",
  location: "地区",
  rating: "星级",
  title: "标题",
  comment: "评论",
  photos: "图片",
  variant: "规格",
  createdAt: "时间",
  isVisible: "显示",
  "(root)": "整行",
};

type RowField =
  | "authorName"
  | "location"
  | "rating"
  | "title"
  | "comment"
  | "photos"
  | "variant"
  | "createdAt";
type RowErrors = Partial<Record<RowField, string>>;

type PhotoState = "uploading" | "done" | "error";

interface PhotoSlot {
  id: string;
  url: string;
  state: PhotoState;
  error?: string;
}

interface GridRow {
  key: string;
  authorName: string;
  location: string;
  rating: number;
  title: string;
  comment: string;
  photos: PhotoSlot[];
  // Free-text option descriptor shown under the review date on the PDP.
  variant: string;
  // datetime-local value in the operator's local zone ("" = now).
  createdAt: string;
  isVisible: boolean;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function newRow(): GridRow {
  return {
    key: nextId("row"),
    authorName: "",
    location: "",
    rating: 5,
    title: "",
    comment: "",
    photos: [],
    variant: "",
    createdAt: "",
    isVisible: true,
  };
}

/**
 * Parse a pasted date cell. Accepts "", "YYYY-MM-DD", "YYYY-MM-DD HH:mm[:ss]",
 * the datetime-local T-form and ISO strings. Date-only is interpreted in the
 * local zone. Returns a datetime-local value, or a Chinese error message.
 */
function parseTsvDate(raw: string): { value: string; error?: string } {
  const text = raw.trim();
  if (!text) return { value: "" };
  let d: Date | null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, day] = text.split("-").map(Number);
    d = new Date(y, m - 1, day);
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    d = new Date(text.replace(" ", "T"));
  } else {
    const ts = Date.parse(text);
    d = Number.isNaN(ts) ? null : new Date(ts);
  }
  if (!d || Number.isNaN(d.getTime())) {
    return { value: "", error: "时间格式无法识别（用 2026-08-01 或 2026-08-01 14:30）" };
  }
  if (d.getTime() < Date.UTC(2000, 0, 1)) return { value: "", error: "时间不能早于 2000 年" };
  if (d.getTime() > Date.now() + 60_000) return { value: "", error: "时间不能晚于当前时间" };
  return { value: dateToLocalInput(d) };
}

function validPhotoUrl(value: string): boolean {
  // Same rule as the backend siteMediaUrl validator: absolute http(s) link or
  // a site-relative /uploads path (protocol-relative "//" stays rejected).
  if (value.startsWith("/") && !value.startsWith("//") && value.length > 1) {
    return value.length <= 2048;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && value.length <= 2048;
  } catch {
    return false;
  }
}

// Client mirror of createAdminReviewSchema, per row.
function validateRow(row: GridRow): RowErrors {
  const errors: RowErrors = {};
  const authorName = row.authorName.trim();
  const location = row.location.trim();
  const title = row.title.trim();
  const comment = row.comment.trim();

  if (authorName.length < 1) errors.authorName = "必填";
  else if (authorName.length > 120) errors.authorName = "不超过 120 字";
  if (location.length > 120) errors.location = "不超过 120 字";
  if (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5)
    errors.rating = "1–5";
  if (title.length > 200) errors.title = "不超过 200 字";
  if (comment.length < 1) errors.comment = "必填";
  else if (comment.length > 5000) errors.comment = "不超过 5000 字";
  if (row.variant.trim().length > 300) errors.variant = "规格最多 300 个字符。";

  const createdAt = row.createdAt.trim();
  if (createdAt) {
    const when = new Date(createdAt);
    if (Number.isNaN(when.getTime())) errors.createdAt = "时间格式不正确";
    else if (when.getTime() < Date.UTC(2000, 0, 1)) errors.createdAt = "不能早于 2000 年";
    else if (when.getTime() > Date.now() + 60_000) errors.createdAt = "不能晚于当前时间";
  }

  if (row.photos.some((p) => p.state === "uploading")) errors.photos = "图片上传中";
  else if (row.photos.some((p) => p.state === "error"))
    errors.photos = "有图片未上传成功，请删除或重试";
  else if (row.photos.length > MAX_PHOTOS) errors.photos = `最多 ${MAX_PHOTOS} 张`;

  return errors;
}

/** Parse TSV pasted from a sheet; returns rows to append plus skipped lines. */
function parseTsv(raw: string, capacity: number): { rows: GridRow[]; skipped: string[] } {
  const rows: GridRow[] = [];
  const skipped: string[] = [];
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0);

  if (lines.length > MAX_ROWS) {
    return { rows, skipped: [`超过单次上限：一次最多 ${MAX_ROWS} 行`] };
  }

  lines.forEach((line, i) => {
    const rowNumber = i + 1;
    if (rows.length >= capacity) {
      skipped.push(`第 ${rowNumber} 行：超过总数上限 ${MAX_ROWS} 行，未填入`);
      return;
    }
    const cells = line.split("\t");
    if (cells.length < 5 || cells.length > 8) {
      skipped.push(`第 ${rowNumber} 行：应为 5–8 列（Tab 分隔），实际 ${cells.length} 列`);
      return;
    }
    const [
      authorName,
      location,
      ratingRaw,
      title,
      comment,
      photosRaw = "",
      dateRaw = "",
      variantRaw = "",
    ] = cells;
    const problems: string[] = [];
    const name = authorName.trim();
    if (!name || name.length > 120) problems.push("姓名必填且不超过 120 字");
    if (location.trim().length > 120) problems.push("地区不超过 120 字");
    const rating = Number(ratingRaw.trim());
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      problems.push("星级必须是 1–5 的整数");
    if (title.trim().length > 200) problems.push("标题不超过 200 字");
    if (!comment.trim() || comment.trim().length > 5000)
      problems.push("评论必填且不超过 5000 字");
    const photoUrls = photosRaw
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    if (photoUrls.length > MAX_PHOTOS) {
      problems.push(`图片最多 ${MAX_PHOTOS} 张`);
    } else if (!photoUrls.every(validPhotoUrl)) {
      problems.push("图片 URL 需为 http(s) 开头的合法链接");
    }
    if (variantRaw.trim().length > 300) problems.push("规格最多 300 个字符");
    const parsedDate = parseTsvDate(dateRaw);
    if (parsedDate.error) problems.push(parsedDate.error);
    if (problems.length > 0) {
      skipped.push(`第 ${rowNumber} 行：${problems.join("；")}`);
      return;
    }
    rows.push({
      ...newRow(),
      authorName: name,
      location: location.trim(),
      rating,
      title: title.trim(),
      comment: comment.trim(),
      photos: photoUrls.map((url) => ({ id: nextId("photo"), url, state: "done" as const })),
      variant: variantRaw.trim(),
      createdAt: parsedDate.value,
    });
  });

  return { rows, skipped };
}

/** Per-row photo editor: thumbnails, multi-file upload, URL add. */
function PhotoCell({
  row,
  disabled,
  onFiles,
  onRemove,
  onAddUrl,
}: {
  row: GridRow;
  disabled: boolean;
  onFiles: (rowKey: string, files: File[]) => void;
  onRemove: (rowKey: string, photoId: string) => void;
  onAddUrl: (rowKey: string, url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const slotsFull = row.photos.length >= MAX_PHOTOS;

  function addUrl() {
    const value = urlDraft.trim();
    if (!value) return;
    onAddUrl(row.key, value);
    setUrlDraft("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      {row.photos.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.photos.map((photo) => {
            if (photo.state === "uploading") {
              return (
                <span
                  key={photo.id}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-primary-light/40 text-[10px] text-ink-muted"
                >
                  上传中
                </span>
              );
            }
            if (photo.state === "error") {
              return (
                <span
                  key={photo.id}
                  title={photo.error}
                  className="relative flex h-11 w-11 items-center justify-center rounded-lg border border-sale/40 bg-sale/5 text-center text-[10px] leading-tight text-red-700"
                >
                  失败
                  <button
                    type="button"
                    aria-label="删除失败图片"
                    onClick={() => onRemove(row.key, photo.id)}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] text-white"
                  >
                    ✕
                  </button>
                </span>
              );
            }
            return (
              <span key={photo.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin-only uploaded/URL thumbs; no optimizer allowlist. */}
                <img
                  src={photo.url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-11 w-11 rounded-lg border border-border object-cover"
                />
                <button
                  type="button"
                  aria-label="删除图片"
                  onClick={() => onRemove(row.key, photo.id)}
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink-muted text-[9px] text-white hover:bg-red-600"
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={disabled || slotsFull}
        className="h-8 rounded-lg border border-cta/40 px-2 text-xs font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
      >
        {slotsFull ? `已达 ${MAX_PHOTOS} 张` : "上传图片"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(row.key, files);
          e.target.value = "";
        }}
      />
      <input
        value={urlDraft}
        onChange={(e) => setUrlDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addUrl();
          }
        }}
        placeholder="或粘贴图片 URL"
        disabled={disabled || slotsFull}
        aria-label="图片 URL"
        className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none disabled:bg-primary-light/30"
      />
      {urlDraft.trim() && !validPhotoUrl(urlDraft.trim()) ? (
        <p className="text-[11px] text-red-700">需为 http(s) 开头的合法链接</p>
      ) : null}
      <button
        type="button"
        onClick={addUrl}
        disabled={disabled || slotsFull || !urlDraft.trim() || !validPhotoUrl(urlDraft.trim())}
        className="h-7 self-start rounded-lg px-2 text-xs font-semibold text-cta hover:underline disabled:text-ink-muted disabled:no-underline"
      >
        + 添加 URL
      </button>
    </div>
  );
}

export function BatchReviewsGridDialog({
  productId,
  open,
  onClose,
  onImported,
}: {
  productId: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [rows, setRows] = useState<GridRow[]>([newRow()]);
  const [clientErrors, setClientErrors] = useState<Record<string, RowErrors>>({});
  const [serverErrors, setServerErrors] = useState<BatchLineError[] | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<number | null>(null);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteRaw, setPasteRaw] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const uploading = rows.some((row) => row.photos.some((p) => p.state === "uploading"));

  function reset() {
    setRows([newRow()]);
    setClientErrors({});
    setServerErrors(null);
    setFatal(null);
    setCreated(null);
    setPasteOpen(false);
    setPasteRaw("");
    setPasteNote(null);
  }

  function close() {
    if (pending || uploading) return;
    reset();
    onClose();
  }

  function patchRow(key: string, patch: Partial<GridRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setClientErrors((prev) => {
      if (!prev[key]) return prev;
      return { ...prev, [key]: {} };
    });
  }

  function addRow() {
    setRows((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, newRow()]));
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
    setClientErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function addPhotoUrl(rowKey: string, url: string) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== rowKey) return row;
        if (row.photos.length >= MAX_PHOTOS) return row;
        if (row.photos.some((p) => p.url === url)) return row;
        return {
          ...row,
          photos: [...row.photos, { id: nextId("photo"), url, state: "done" }],
        };
      }),
    );
  }

  function removePhoto(rowKey: string, photoId: string) {
    setRows((prev) =>
      prev.map((row) =>
        row.key === rowKey ? { ...row, photos: row.photos.filter((p) => p.id !== photoId) } : row,
      ),
    );
  }

  function markPhoto(rowKey: string, photoId: string, patch: Partial<PhotoSlot>) {
    setRows((prev) =>
      prev.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              photos: row.photos.map((p) => (p.id === photoId ? { ...p, ...patch } : p)),
            }
          : row,
      ),
    );
  }

  async function uploadOne(rowKey: string, file: File, slotId: string) {
    try {
      // Local-disk upload via the backend (was: R2 presigned PUT — R2 is not
      // configured on this deployment). Same site-relative /uploads URLs.
      const res = await adminApi.uploadImage(
        file,
        resolveUploadType(file.name, file.type, "image") ?? "image/jpeg",
      );
      markPhoto(rowKey, slotId, { state: "done", url: res.url, error: undefined });
      // A successful upload clears the transient file-pick rejection note.
      setClientErrors((prev) => {
        const current = prev[rowKey];
        if (!current?.photos) return prev;
        const nextRowErrors = { ...current };
        delete nextRowErrors.photos;
        const next = { ...prev };
        if (Object.keys(nextRowErrors).length === 0) delete next[rowKey];
        else next[rowKey] = nextRowErrors;
        return next;
      });
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "图片上传失败，请重试，或直接粘贴图片 URL";
      markPhoto(rowKey, slotId, { state: "error", url: "", error: message });
    }
  }

  function handleFiles(rowKey: string, files: File[]) {
    const row = rows.find((r) => r.key === rowKey);
    if (!row) return;
    const capacity = MAX_PHOTOS - row.photos.length;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      // Same tolerance as the media picker: File.type is empty for plenty of
      // real images, so fall back to the extension.
      if (!resolveUploadType(file.name, file.type, "image")) {
        rejected.push(`「${file.name || "文件"}」仅支持 JPG / PNG / WebP`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        rejected.push(`「${file.name || "文件"}」超过 8MB`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > capacity) {
      rejected.push(`每行最多 ${MAX_PHOTOS} 张，已忽略多出的 ${accepted.length - capacity} 张`);
    }
    const toUpload = accepted.slice(0, Math.max(0, capacity));
    if (toUpload.length === 0 && rejected.length > 0) {
      setClientErrors((prev) => ({
        ...prev,
        [rowKey]: { ...prev[rowKey], photos: rejected[0] },
      }));
      return;
    }
    const newSlots: PhotoSlot[] = toUpload.map(() => ({
      id: nextId("photo"),
      url: "",
      state: "uploading" as const,
    }));
    setRows((prev) =>
      prev.map((r) =>
        r.key === rowKey ? { ...r, photos: [...r.photos, ...newSlots] } : r,
      ),
    );
    if (rejected.length > 0) {
      setClientErrors((prev) => ({
        ...prev,
        [rowKey]: { ...prev[rowKey], photos: rejected.join("；") },
      }));
    }
    toUpload.forEach((file, i) => {
      void uploadOne(rowKey, file, newSlots[i].id);
    });
  }

  function fillFromPaste() {
    const raw = pasteRaw;
    if (!raw.trim()) {
      setPasteNote("请先粘贴至少一行");
      return;
    }
    const capacity = MAX_ROWS - rows.length;
    const { rows: parsed, skipped } = parseTsv(raw, capacity);
    if (parsed.length === 0) {
      setPasteNote(skipped.join("\n") || "没有可填入的行");
      return;
    }
    setRows((prev) => [...prev, ...parsed]);
    setPasteRaw("");
    setPasteOpen(false);
    const note = `已填入 ${parsed.length} 行${skipped.length > 0 ? `；${skipped.length} 行跳过` : ""}`;
    setPasteNote(skipped.length > 0 ? `${note}\n${skipped.join("\n")}` : note);
  }

  async function submit() {
    const found: Record<string, RowErrors> = {};
    rows.forEach((row) => {
      const errs = validateRow(row);
      if (Object.keys(errs).length > 0) found[row.key] = errs;
    });
    setClientErrors(found);
    setServerErrors(null);
    setFatal(null);
    if (Object.keys(found).length > 0) return;

    // Batch rows validate against createAdminReviewSchema: optional text
    // fields must be omitted (undefined), not null — zod rejects null there.
    const items: BatchReviewInput[] = rows.map((row) => ({
      authorName: row.authorName.trim(),
      location: row.location.trim() || undefined,
      rating: row.rating,
      title: row.title.trim() || undefined,
      comment: row.comment.trim(),
      photos: row.photos.map((p) => p.url),
      variant: row.variant.trim() || undefined,
      isVisible: row.isVisible,
      // Empty lets the backend stamp now; grid validation already rejected
      // unparseable/future values.
      createdAt: row.createdAt.trim() ? new Date(row.createdAt.trim()).toISOString() : undefined,
    }));

    setPending(true);
    try {
      const res = await adminApi.batchCreateReviews(productId, items);
      setCreated(res.created);
      onImported();
    } catch (err) {
      if (err instanceof AdminApiError && Array.isArray(err.details)) {
        setServerErrors(err.details as BatchLineError[]);
      } else {
        setFatal(err instanceof Error ? err.message : "导入失败，请重试");
      }
    } finally {
      setPending(false);
    }
  }

  // Map backend 1-based row numbers onto current row keys (submitted order).
  const serverByRowKey = new Map<string, BatchLineError[]>();
  (serverErrors ?? []).forEach((e) => {
    const key = rows[e.row - 1]?.key;
    if (!key) return;
    const list = serverByRowKey.get(key) ?? [];
    list.push(e);
    serverByRowKey.set(key, list);
  });

  // datetime-local `max` is evaluated per render; future values are also
  // rejected by validateRow/parseTsvDate in case the dialog stays open long.
  const maxDate = nowLocalInput();

  const errorRowKeys = new Set([
    ...Object.keys(clientErrors).filter((k) => Object.keys(clientErrors[k] ?? {}).length > 0),
    ...serverByRowKey.keys(),
  ]);

  return (
    <Dialog open={open} onClose={close} title="批量添加评论" width="lg">
      {created !== null ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium text-ink" role="status">
            成功导入 {created} 条评论（默认对顾客可见，可在列表中逐条隐藏）。
          </p>
          <div className="flex justify-end">
            <Button
              size="md"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              完成
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-muted">
              每行一条评论，全部填写后一次保存（全部成功才入库）。图片可直传或粘贴 URL，每行最多 {MAX_PHOTOS} 张。
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="md"
                className="h-9 min-w-[120px] px-3 text-sm"
                onClick={() => {
                  setPasteOpen((v) => !v);
                  setPasteNote(null);
                }}
              >
                从 Excel/表格粘贴
              </Button>
              <Button
                size="md"
                className="h-9 min-w-[96px] px-3 text-sm"
                onClick={addRow}
                disabled={rows.length >= MAX_ROWS}
              >
                + 加一行
              </Button>
            </div>
          </div>

          {pasteOpen ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-primary-light/20 p-3">
              <p className="text-xs leading-relaxed text-ink-secondary">{FORMAT_HINT}</p>
              <p className="text-xs text-ink-muted">
                示例（Tab 分隔）：
                <br />
                <span className="font-mono break-all">{EXAMPLE_LINE}</span>
              </p>
              <textarea
                aria-label="批量评论文本（TSV）"
                className="min-h-[160px] w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-sm text-ink"
                value={pasteRaw}
                placeholder={EXAMPLE_LINE}
                onChange={(e) => setPasteRaw(e.target.value)}
                disabled={pending}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="whitespace-pre-line text-xs text-ink-muted">{pasteNote}</p>
                <Button
                  size="md"
                  className="h-9 shrink-0 px-3 text-sm"
                  onClick={fillFromPaste}
                  disabled={pending}
                >
                  填入表格
                </Button>
              </div>
            </div>
          ) : pasteNote ? (
            <p className="whitespace-pre-line rounded-lg bg-primary-light/30 p-2 text-xs text-ink-secondary">
              {pasteNote}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[1420px] text-sm">
              <caption className="sr-only">批量评论表格</caption>
              <thead>
                <tr className="border-b border-border bg-primary-light/30 text-left text-xs font-semibold text-ink-secondary">
                  <th scope="col" className="w-10 px-2 py-2">#</th>
                  <th scope="col" className="w-40 px-2 py-2">
                    作者 <span className="text-red-700">*</span>
                  </th>
                  <th scope="col" className="w-32 px-2 py-2">
                    地区
                  </th>
                  <th scope="col" className="w-44 px-2 py-2">
                    标题
                  </th>
                  <th scope="col" className="px-2 py-2">
                    评论 <span className="text-red-700">*</span>
                  </th>
                  <th scope="col" className="w-52 px-2 py-2">
                    图片（最多 {MAX_PHOTOS} 张）
                  </th>
                  <th scope="col" className="w-40 px-2 py-2">
                    规格
                  </th>
                  <th scope="col" className="w-48 px-2 py-2">
                    时间（可空=当前）
                  </th>
                  <th scope="col" className="w-24 px-2 py-2">
                    评分
                  </th>
                  <th scope="col" className="w-16 px-2 py-2">
                    显示
                  </th>
                  <th scope="col" className="w-12 px-2 py-2">
                    <span className="sr-only">删除行</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const rowErrs = clientErrors[row.key] ?? {};
                  const srvErrs = serverByRowKey.get(row.key) ?? [];
                  const hasError = errorRowKeys.has(row.key);
                  return (
                    <Fragment key={row.key}>
                    <tr
                      className={`align-top ${hasError ? "bg-sale/5" : ""} border-b border-border last:border-0`}
                    >
                      <td className="px-2 py-2 text-xs text-ink-muted">{index + 1}</td>
                      <td className="px-2 py-2">
                        <input
                          value={row.authorName}
                          maxLength={120}
                          onChange={(e) => patchRow(row.key, { authorName: e.target.value })}
                          disabled={pending}
                          aria-label={`第 ${index + 1} 行作者`}
                          className={`w-full rounded-lg border bg-card px-2 py-1.5 text-sm focus:outline-none ${
                            rowErrs.authorName
                              ? "border-sale/60 focus:border-sale"
                              : "border-border focus:border-cta"
                          }`}
                        />
                        {rowErrs.authorName ? (
                          <p className="mt-0.5 text-[11px] text-red-700">{rowErrs.authorName}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.location}
                          maxLength={120}
                          placeholder="可空"
                          onChange={(e) => patchRow(row.key, { location: e.target.value })}
                          disabled={pending}
                          aria-label={`第 ${index + 1} 行地区`}
                          className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus:border-cta focus:outline-none"
                        />
                        {rowErrs.location ? (
                          <p className="mt-0.5 text-[11px] text-red-700">{rowErrs.location}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.title}
                          maxLength={200}
                          placeholder="可空"
                          onChange={(e) => patchRow(row.key, { title: e.target.value })}
                          disabled={pending}
                          aria-label={`第 ${index + 1} 行标题`}
                          className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus:border-cta focus:outline-none"
                        />
                        {rowErrs.title ? (
                          <p className="mt-0.5 text-[11px] text-red-700">{rowErrs.title}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <textarea
                          value={row.comment}
                          rows={3}
                          maxLength={5000}
                          onChange={(e) => patchRow(row.key, { comment: e.target.value })}
                          disabled={pending}
                          aria-label={`第 ${index + 1} 行评论`}
                          className={`w-full resize-y rounded-lg border bg-card px-2 py-1.5 text-sm focus:outline-none ${
                            rowErrs.comment
                              ? "border-sale/60 focus:border-sale"
                              : "border-border focus:border-cta"
                          }`}
                        />
                        {rowErrs.comment ? (
                          <p className="mt-0.5 text-[11px] text-red-700">{rowErrs.comment}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <PhotoCell
                          row={row}
                          disabled={pending}
                          onFiles={handleFiles}
                          onRemove={removePhoto}
                          onAddUrl={addPhotoUrl}
                        />
                        {rowErrs.photos ? (
                          <p className="mt-0.5 text-[11px] text-red-700">{rowErrs.photos}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.variant}
                          maxLength={300}
                          placeholder="可空，如 Color: … | Size: …"
                          onChange={(e) => patchRow(row.key, { variant: e.target.value })}
                          disabled={pending}
                          aria-label={`第 ${index + 1} 行规格`}
                          className={`w-full rounded-lg border bg-card px-2 py-1.5 text-sm focus:outline-none ${
                            rowErrs.variant
                              ? "border-sale/60 focus:border-sale"
                              : "border-border focus:border-cta"
                          }`}
                        />
                        {rowErrs.variant ? (
                          <p className="mt-0.5 text-[11px] text-red-700">{rowErrs.variant}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="datetime-local"
                          value={row.createdAt}
                          min="2000-01-01T00:00"
                          max={maxDate}
                          onChange={(e) => patchRow(row.key, { createdAt: e.target.value })}
                          disabled={pending}
                          aria-label={`第 ${index + 1} 行时间`}
                          title="留空 = 提交时的当前时间"
                          className={`w-44 rounded-lg border bg-card px-2 py-1.5 text-sm focus:outline-none ${
                            rowErrs.createdAt
                              ? "border-sale/60 focus:border-sale"
                              : "border-border focus:border-cta"
                          }`}
                        />
                        {rowErrs.createdAt ? (
                          <p className="mt-0.5 text-[11px] text-red-700">{rowErrs.createdAt}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={row.rating}
                          onChange={(e) => patchRow(row.key, { rating: Number(e.target.value) })}
                          disabled={pending}
                          aria-label={`第 ${index + 1} 行评分`}
                          className="w-20 rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus:border-cta focus:outline-none"
                        >
                          {[5, 4, 3, 2, 1].map((value) => (
                            <option key={value} value={value}>
                              {value} 星
                            </option>
                          ))}
                        </select>
                        {rowErrs.rating ? (
                          <p className="mt-0.5 text-[11px] text-red-700">{rowErrs.rating}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
                          <input
                            type="checkbox"
                            checked={row.isVisible}
                            onChange={(e) => patchRow(row.key, { isVisible: e.target.checked })}
                            disabled={pending}
                            className="h-4 w-4 rounded border-border accent-cta"
                          />
                          显示
                        </label>
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => removeRow(row.key)}
                          disabled={pending || rows.length === 1}
                          aria-label={`删除第 ${index + 1} 行`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-ink-muted hover:border-sale/50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                    {srvErrs.length > 0 ? (
                      <tr className={hasError ? "bg-sale/5" : ""}>
                        <td colSpan={11} className="border-b border-border px-2 pb-2">
                          <p className="text-[11px] leading-relaxed text-red-700">
                            {srvErrs.map((error, i) => (
                              <span key={i} className="mr-3">
                                {error.field !== "(root)"
                                  ? `${FIELD_LABELS[error.field] ?? error.field}：${error.message}`
                                  : error.message}
                              </span>
                            ))}
                          </p>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {serverErrors && serverErrors.length > 0 ? (
            <div
              role="alert"
              className="max-h-40 overflow-y-auto rounded-lg border border-sale/40 bg-sale/5 p-3 text-xs text-red-700"
            >
              <p className="font-semibold">
                有评论行未通过后端校验，未导入任何评论，请修正后重试：
              </p>
              <ul className="mt-1 list-disc pl-4">
                {serverErrors.map((error, i) => (
                  <li key={`${error.row}-${error.field}-${i}`}>
                    {error.row > 0 ? `第 ${error.row} 行 · ${FIELD_LABELS[error.field] ?? error.field}：` : ""}
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {fatal ? (
            <p role="alert" className="text-sm text-red-700">
              {fatal}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">
              共 {rows.length} 行{uploading ? " · 图片上传中…" : ""}
              {errorRowKeys.size > 0 ? ` · ${errorRowKeys.size} 行待修正` : ""}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                size="md"
                onClick={close}
                disabled={pending || uploading}
              >
                取消
              </Button>
              <Button
                size="md"
                onClick={() => void submit()}
                disabled={pending || uploading || rows.length === 0}
                aria-busy={pending}
              >
                {pending ? "导入中…" : uploading ? "等待图片上传…" : `保存全部（${rows.length} 条）`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
