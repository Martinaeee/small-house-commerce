"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/admin/Dialog";
import { AdminApiError } from "@/lib/admin-auth";
import {
  adminApi,
  type BatchLineError,
  type BatchReviewInput,
} from "@/lib/admin-api";

// Column order mirrors the backend createAdminReviewSchema (Task 6).
const FORMAT_HINT =
  "每行一条，列之间用 Tab（制表符，可直接从 Excel/Google Sheets 整列粘贴）：姓名 ⇥ 地区(可空) ⇥ 星级1-5 ⇥ 标题(可空) ⇥ 评论 ⇥ 图片URL(可空，多张用 | 分隔)";
const EXAMPLE_LINE =
  "Maria Santos\tManila\t5\tSturdy shelf\tEasy to assemble and holds our books.\thttps://example.com/a.jpg|https://example.com/b.jpg";

type Parsed =
  | { ok: true; items: BatchReviewInput[] }
  | { ok: false; errors: BatchLineError[] };

function parseBatch(raw: string): Parsed {
  const errors: BatchLineError[] = [];
  const items: BatchReviewInput[] = [];
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { ok: false, errors: [{ row: 0, field: "(root)", message: "请先粘贴至少一行评论" }] };
  }
  if (lines.length > 100) {
    errors.push({ row: 0, field: "(root)", message: "一次最多导入 100 条" });
    return { ok: false, errors };
  }

  lines.forEach((line, i) => {
    const row = i + 1;
    const cells = line.split("\t");
    if (cells.length < 5 || cells.length > 6) {
      errors.push({ row, field: "(root)", message: `应为 5–6 列（Tab 分隔），实际 ${cells.length} 列` });
      return;
    }
    const [authorName, location, ratingRaw, title, comment, photosRaw] = cells;
    const name = authorName.trim();
    if (!name || name.length > 120)
      errors.push({ row, field: "authorName", message: "姓名必填且不超过 120 字" });
    const locationTrim = location.trim();
    if (locationTrim.length > 120)
      errors.push({ row, field: "location", message: "地区不超过 120 字" });
    const rating = Number(ratingRaw.trim());
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      errors.push({ row, field: "rating", message: "星级必须是 1–5 的整数" });
    const titleTrim = title.trim();
    if (titleTrim.length > 200)
      errors.push({ row, field: "title", message: "标题不超过 200 字" });
    const commentTrim = comment.trim();
    if (!commentTrim || commentTrim.length > 5000)
      errors.push({ row, field: "comment", message: "评论必填且不超过 5000 字" });
    const photos = (photosRaw ?? "")
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    if (photos.length > 6) {
      errors.push({ row, field: "photos", message: "每条评论最多 6 张图片" });
    } else {
      for (const photo of photos) {
        try {
          new URL(photo);
          if (!/^https?:\/\//.test(photo) || photo.length > 2048) throw new Error("bad");
        } catch {
          errors.push({ row, field: "photos", message: `图片 URL 不合法：${photo}` });
        }
      }
    }
    items.push({
      authorName: name,
      location: locationTrim || undefined,
      rating,
      title: titleTrim || undefined,
      comment: commentTrim,
      photos,
      isVisible: true,
    });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, items };
}

export function BatchImportReviewsDialog({
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
  const [raw, setRaw] = useState("");
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<BatchLineError[] | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  const parsed = parseBatch(raw);
  const clientErrors = raw.trim() && !parsed.ok ? parsed.errors : [];

  function close() {
    setRaw("");
    setServerErrors(null);
    setFatal(null);
    setCreated(null);
    onClose();
  }

  async function submit() {
    const result = parseBatch(raw);
    if (!result.ok) {
      setServerErrors(null);
      setFatal(null);
      return; // errors already rendered from clientErrors
    }
    setPending(true);
    setServerErrors(null);
    setFatal(null);
    try {
      const res = await adminApi.batchCreateReviews(productId, result.items);
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

  const shownErrors = serverErrors ?? clientErrors;

  return (
    <Dialog open={open} onClose={close} title="批量导入评论">
      {created !== null ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium text-ink" role="status">
            成功导入 {created} 条评论（默认对顾客可见，可在列表中逐条隐藏）。
          </p>
          <div className="flex justify-end">
            <Button size="md" onClick={close}>
              完成
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-primary-light/40 p-3 text-xs leading-relaxed text-ink-secondary">
            {FORMAT_HINT}
          </p>
          <p className="text-xs text-ink-muted">
            示例（Tab 分隔）：
            <br />
            <span className="font-mono break-all">{EXAMPLE_LINE}</span>
          </p>
          <textarea
            aria-label="批量评论文本（TSV）"
            className="min-h-[240px] w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-sm text-ink"
            value={raw}
            placeholder={EXAMPLE_LINE}
            onChange={(e) => setRaw(e.target.value)}
            disabled={pending}
          />
          {shownErrors.length > 0 ? (
            <div
              role="alert"
              className="max-h-48 overflow-y-auto rounded-lg border border-sale/40 bg-sale/5 p-3 text-xs text-red-700"
            >
              <p className="font-semibold">
                {serverErrors
                  ? "有评论行未通过后端校验，未导入任何评论，请修正后重试："
                  : "请先修正以下行："}
              </p>
              <ul className="mt-1 list-disc pl-4">
                {shownErrors.map((error, i) => (
                  <li key={`${error.row}-${error.field}-${i}`}>
                    {error.row > 0 ? `第 ${error.row} 行 · ${error.field}：` : ""}
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
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="md" onClick={close} disabled={pending}>
              取消
            </Button>
            <Button size="md" onClick={() => void submit()} disabled={pending}>
              {pending ? "导入中…" : "导入（全部成功才入库）"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
