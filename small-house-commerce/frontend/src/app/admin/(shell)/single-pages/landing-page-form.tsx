"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, Textarea } from "@/components/admin/Field";
import {
  adminApi,
  type AdminLandingPageDetail,
  type AdminProduct,
  type LandingImageOverrideInput,
  type LandingPageInput,
  type LandingStatus,
} from "@/lib/admin-api";

export interface LandingFormValue {
  name: string;
  slug: string;
  adCode: string;
  titleOverride: string;
  images: LandingImageOverrideInput[];
  seoTitle: string;
  seoDescription: string;
  promoEnabled: boolean;
  promoHeadline: string;
  promoSubtext: string;
  startAt: string; // datetime-local
  endAt: string;
  status: LandingStatus;
  sortOrder: string;
}

export const emptyLandingForm: LandingFormValue = {
  name: "",
  slug: "",
  adCode: "",
  titleOverride: "",
  images: [],
  seoTitle: "",
  seoDescription: "",
  promoEnabled: false,
  promoHeadline: "",
  promoSubtext: "",
  startAt: "",
  endAt: "",
  status: "ACTIVE",
  sortOrder: "0",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function landingFormFromDetail(detail: AdminLandingPageDetail): LandingFormValue {
  return {
    name: detail.name,
    slug: detail.slug,
    adCode: detail.adCode ?? "",
    titleOverride: detail.titleOverride ?? "",
    images: detail.imagesOverride ?? [],
    seoTitle: detail.seoTitle ?? "",
    seoDescription: detail.seoDescription ?? "",
    promoEnabled: detail.promoEnabled,
    promoHeadline: detail.promoHeadline ?? "",
    promoSubtext: detail.promoSubtext ?? "",
    startAt: toLocalInput(detail.startAt),
    endAt: toLocalInput(detail.endAt),
    status: detail.status,
    sortOrder: String(detail.sortOrder),
  };
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateLandingForm(
  form: LandingFormValue,
  isCreate: boolean,
): string[] {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push("内部名称必填");
  if (form.name.trim().length > 120) errors.push("内部名称最多 120 字");
  if (isCreate) {
    if (!form.slug.trim()) errors.push("Slug（链接标识）必填");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim()))
      errors.push("Slug 只能用小写字母、数字、连字符，且不能以连字符开头/结尾");
  }
  if (form.adCode.trim().length > 64) errors.push("FB 目录编号最多 64 字");
  if (form.titleOverride.trim().length > 200) errors.push("标题覆盖最多 200 字");
  if (form.images.length > 10) errors.push("覆盖图片最多 10 张");
  for (const [i, image] of form.images.entries()) {
    if (!/^https?:\/\/.+/.test(image.url)) errors.push(`第 ${i + 1} 张图片 URL 不合法`);
  }
  if (form.promoEnabled && !form.promoHeadline.trim())
    errors.push("开启促销块时必须填写促销标题");
  if (
    form.startAt &&
    form.endAt &&
    new Date(form.endAt).getTime() <= new Date(form.startAt).getTime()
  )
    errors.push("结束时间必须晚于开始时间");
  if (!Number.isInteger(Number(form.sortOrder)) || Number(form.sortOrder) < 0)
    errors.push("Sort 必须是不小于 0 的整数");
  return errors;
}

export function toLandingInput(form: LandingFormValue): LandingPageInput {
  return {
    name: form.name.trim(),
    slug: form.slug.trim(),
    adCode: form.adCode.trim() || null,
    titleOverride: form.titleOverride.trim() || null,
    imagesOverride: form.images.length
      ? form.images.map((image) => ({ url: image.url, altText: image.altText ?? null }))
      : null,
    seoTitle: form.seoTitle.trim() || null,
    seoDescription: form.seoDescription.trim() || null,
    promoEnabled: form.promoEnabled,
    promoHeadline: form.promoHeadline.trim() || null,
    promoSubtext: form.promoSubtext.trim() || null,
    startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
    endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
    status: form.status,
    sortOrder: Number(form.sortOrder) || 0,
  };
}

const REMOVE_BTN =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-sm text-ink-muted hover:border-sale hover:text-sale";

export function LandingPageForm({
  mode,
  initial,
  lockedProduct,
  pending,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial: LandingFormValue;
  lockedProduct?: { id: string; name: string } | null;
  pending: boolean;
  onSubmit: (productId: string, input: LandingPageInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<LandingFormValue>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<AdminProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [productId, setProductId] = useState<string | null>(lockedProduct?.id ?? null);
  const [productName, setProductName] = useState<string>(lockedProduct?.name ?? "");

  const set = <K extends keyof LandingFormValue>(key: K, value: LandingFormValue[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function runSearch() {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const result = await adminApi.listProducts({ search: search.trim(), page: 1, pageSize: 8 });
      setCandidates(result.items);
    } finally {
      setSearching(false);
    }
  }

  function submit() {
    const next = validateLandingForm(form, mode === "create");
    if (!productId) next.push("请先选择所属产品");
    if (next.length > 0) {
      setErrors(next);
      return;
    }
    onSubmit(productId as string, toLandingInput(form));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg bg-primary-light/40 p-3 text-xs leading-relaxed text-ink-secondary">
        独立 URL、共享 SKU/库存/评论、停用或时间窗外链接 404。
      </p>

      {errors.length > 0 ? (
        <ul className="rounded-lg border border-sale/40 bg-sale/5 p-3 text-xs text-red-700" role="alert">
          {errors.map((error) => (
            <li key={error}>• {error}</li>
          ))}
        </ul>
      ) : null}

      {mode === "create" ? (
        <Field label="所属产品">
          {productId ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
              <span className="font-medium text-ink">{productName}</span>
              <button
                type="button"
                className="text-xs font-semibold text-cta hover:underline"
                onClick={() => {
                  setProductId(null);
                  setProductName("");
                }}
              >
                更换
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <TextInput
                  value={search}
                  placeholder="按产品名搜索"
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runSearch();
                    }
                  }}
                />
                <Button type="button" variant="secondary" size="md" onClick={() => void runSearch()}>
                  {searching ? "搜索中…" : "搜索"}
                </Button>
              </div>
              {candidates.length > 0 ? (
                <ul className="rounded-lg border border-border">
                  {candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-primary-light/40"
                        onClick={() => {
                          setProductId(candidate.id);
                          setProductName(candidate.name);
                          setCandidates([]);
                        }}
                      >
                        {candidate.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </Field>
      ) : (
        <Field label="所属产品">
          <p className="text-sm font-medium text-ink">{productName}</p>
        </Field>
      )}

      <Field label="内部名称" hint="内部名称，仅后台显示，如：优化师A-首图版、圣诞促销版。">
        <TextInput value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Field>

      <Field
        label="FB目录编号"
        hint="选填。FB 目录编号 / 广告编号，仅用于后台对照投放。"
      >
        <TextInput value={form.adCode} onChange={(e) => set("adCode", e.target.value)} />
      </Field>

      <Field
        label="Slug（链接标识）"
        hint="链接标识，保存后不要修改；只能小写字母、数字、连字符。中文名请手动填英文，或先填英文名用「生成」。"
      >
        <div className="flex gap-2">
          <TextInput
            value={form.slug}
            placeholder="os-chair-xmas"
            disabled={mode === "edit"}
            onChange={(e) => set("slug", e.target.value)}
          />
          {mode === "create" ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => set("slug", slugifyName(form.name))}
            >
              生成
            </Button>
          ) : null}
        </div>
      </Field>

      <Field label="标题覆盖" hint="选填。覆盖页面 H1 与标题；留空则使用产品名称。">
        <TextInput
          value={form.titleOverride}
          onChange={(e) => set("titleOverride", e.target.value)}
        />
      </Field>

      <Field
        label="图片覆盖"
        hint="选填。留空继承产品主图；建议 4–6 张，顺序即展示顺序。"
      >
        <div className="flex flex-col gap-2">
          {form.images.map((image, i) => (
            <div key={i} className="flex items-center gap-2">
              <TextInput
                aria-label={`第 ${i + 1} 张图片 URL`}
                placeholder="https://…"
                value={image.url}
                onChange={(e) =>
                  set(
                    "images",
                    form.images.map((item, j) => (j === i ? { ...item, url: e.target.value } : item)),
                  )
                }
              />
              <TextInput
                aria-label={`第 ${i + 1} 张图片 alt 文本`}
                placeholder="alt（可空）"
                value={image.altText ?? ""}
                onChange={(e) =>
                  set(
                    "images",
                    form.images.map((item, j) => (j === i ? { ...item, altText: e.target.value } : item)),
                  )
                }
              />
              <button
                type="button"
                aria-label={`移除第 ${i + 1} 张图片`}
                className={REMOVE_BTN}
                onClick={() => set("images", form.images.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          {form.images.length < 10 ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="self-start"
              onClick={() => set("images", [...form.images, { url: "", altText: "" }])}
            >
              添加覆盖图片
            </Button>
          ) : null}
        </div>
      </Field>

      <div className="rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            checked={form.promoEnabled}
            onChange={(e) => set("promoEnabled", e.target.checked)}
          />
          启用促销标题块（显示在页面 H1 上方）
        </label>
        {form.promoEnabled ? (
          <div className="mt-3 flex flex-col gap-3">
            <Field label="促销标题" hint="选填块内必填。只写真实活动文案，不要编造折扣或倒计时。">
              <TextInput
                value={form.promoHeadline}
                onChange={(e) => set("promoHeadline", e.target.value)}
              />
            </Field>
            <Field label="促销副标题">
              <TextInput
                value={form.promoSubtext}
                onChange={(e) => set("promoSubtext", e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="开始时间" hint="选填。未开始前链接 404。">
          <TextInput
            type="datetime-local"
            value={form.startAt}
            onChange={(e) => set("startAt", e.target.value)}
          />
        </Field>
        <Field label="结束时间" hint="选填。结束后链接 404。">
          <TextInput
            type="datetime-local"
            value={form.endAt}
            onChange={(e) => set("endAt", e.target.value)}
          />
        </Field>
      </div>

      <Field label="SEO 标题" hint="选填。留空时使用覆盖标题（或产品名）。">
        <TextInput value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
      </Field>
      <Field label="SEO 描述" hint="选填。留空时使用产品描述。">
        <Textarea
          rows={3}
          value={form.seoDescription}
          onChange={(e) => set("seoDescription", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="状态">
          <select
            aria-label="状态"
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink"
            value={form.status}
            onChange={(e) => set("status", e.target.value as LandingStatus)}
          >
            <option value="ACTIVE">启用</option>
            <option value="DISABLED">停用</option>
          </select>
        </Field>
        <Field label="Sort" hint="数字越小越靠前（同产品列表）。">
          <TextInput
            type="number"
            min={0}
            value={form.sortOrder}
            onChange={(e) => set("sortOrder", e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-2 flex justify-end gap-3">
        <Button type="button" variant="secondary" size="md" onClick={onCancel} disabled={pending}>
          取消
        </Button>
        <Button type="button" size="md" onClick={submit} disabled={pending}>
          {pending ? "保存中…" : mode === "create" ? "创建" : "保存"}
        </Button>
      </div>
    </div>
  );
}
