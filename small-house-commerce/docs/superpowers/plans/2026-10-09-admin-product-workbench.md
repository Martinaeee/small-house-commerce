# Admin Product Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin product editor compact and clear: a wider editing column beside a fixed 280px rail, ~36–38px admin input density, a ~96px thumbnail media grid with hover actions and multi-file batch upload, and a fully scrollable product preview.

**Architecture:** Presentation-only changes inside existing admin components. No backend, Prisma, or save-contract change. A new compact input class is added beside the untouched storefront-sized `inputCls`. The media workspace keeps its controlled-callback model; one new client component (`MediaAddRow`) owns the batch-upload loop and appends through a new `onAddImageUrl` callback that `ProductForm` implements with an exported pure helper. `LivePreview` wraps its children in an internal scroll container so product/collection/category previews can scroll the full page.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Vitest + React Testing Library, Playwright (existing E2E), Chrome DevTools MCP for browser verification.

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-09-admin-product-workbench-design.md`

## Global Constraints

- No backend, Prisma schema, migration, DTO, or save-contract changes. This sub-project is frontend-only.
- `inputCls` (storefront-sized, `py-2.5 text-base`) must stay unchanged for its storefront importers (checkout, login, register, account, PDP quick COD, track order) and for `app/admin/login/page.tsx`.
- Admin density target: ~36–38px control height (`px-3 py-2 text-sm`); checkout/storefront keep their 44px touch targets.
- Media grid thumbnails: `minmax(88px,104px)` (≈96px). Images only for batch upload; accepted types `image/jpeg,image/png,image/webp`; per-file limit 5MB.
- Batch upload calls the existing single-file endpoint sequentially; one failure reports that file and never aborts the batch.
- Every new user-visible string gets both an `en.ts` and a `zh.ts` entry.
- Existing accessible names must not change: `Move media {number} left/right`, `Set as cover`, `Remove media`, `Add photo`, `Add video`, `Shared media cards`, `Media {number}`, `Media {number} (cover)`.
- TDD: write the failing test first, watch it fail, then implement. Commit after each task.
- Local commits only. No push, merge, PR, or deploy. No production data. Never touch or commit `backend/uploads/`. Never restart ports 3000/3001.
- Isolated rehearsal environment only: frontend `http://localhost:3005`, backend `127.0.0.1:3002`, database `small_house_homepage_rehearsal`.
- Working directory for all commands: the worktree root (contains `small-house-commerce/`).

## Review Focus

Failure modes the spec implies but individual task tests may not fully exercise, most likely first:

1. **Batch with mixed valid/invalid files** — one oversized or wrong-type file in a 5-file pick must report only that file and still upload the rest in order. (Test: Task 4, `MediaAddRow` mixed-batch test.)
2. **Double-append via rapid interaction** — clicking "Add URL" twice or picking files while a save is pending must not append duplicates or add rows while disabled. (Tests: Task 4 URL-clears-draft test; Task 4 disabled-during-pending assertion.)
3. **Cover integrity after batch append** — appended rows get `sortOrder = images.length`, so the first row stays cover; a drag reorder after append must renumber without two rows sharing cover. (Test: Task 4 `appendImageUrl` sort-order test plus existing reorder test in Task 3.)
4. **Inner scroll must not move the outer admin page** — scrolling the product preview at the mobile frame scrolls the frame content only; the admin page keeps `window.scrollY === 0`. (Verification: Task 6 browser step.)
5. **Non-product LivePreview consumers** — the collections and categories previews use the same `LivePreview`; the new scroll wrapper must not break their rendering or their specs. (Test: Task 5 runs `CollectionsPanel`/`CategoriesPanel` specs.)

---

### Task 1: Compact admin form density

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/Field.tsx` (lines 9–14, 45–78)
- Modify: `small-house-commerce/frontend/src/components/admin/ImageUrlInput.tsx` (lines 4, 6, 22, 149–198)
- Modify: `small-house-commerce/frontend/src/components/admin/VariantMatrix.tsx` (lines 4, 235, 253, 370, 384, 406, 430, 458)
- Create: `small-house-commerce/frontend/src/components/admin/Field.spec.tsx`

**Interfaces:**
- Produces: `inputClsCompact: string` exported from `@/components/admin/Field`; `MAX_IMAGE_BYTES: number` and `ACCEPT_ATTRS: { image: string; video: string }` exported from `@/components/admin/ImageUrlInput` (Task 4 consumes both).
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `small-house-commerce/frontend/src/components/admin/Field.spec.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Select,
  TextInput,
  Textarea,
  inputCls,
  inputClsCompact,
} from "@/components/admin/Field";

describe("admin form density", () => {
  it("renders the compact control class for admin inputs", () => {
    render(
      <div>
        <TextInput aria-label="name" />
        <Select aria-label="kind">
          <option value="a">A</option>
        </Select>
        <Textarea aria-label="notes" />
      </div>,
    );

    for (const label of ["name", "kind", "notes"]) {
      const control = screen.getByLabelText(label);
      expect(control).toHaveClass("py-2", "text-sm");
      expect(control).not.toHaveClass("py-2.5", "text-base");
    }
  });

  it("keeps the compact and storefront control classes separate", () => {
    expect(inputClsCompact).toContain("py-2");
    expect(inputClsCompact).toContain("text-sm");
    expect(inputCls).toContain("py-2.5");
    expect(inputCls).toContain("text-base");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/Field.spec.tsx`

Expected: FAIL — `inputClsCompact` is not exported, and the rendered controls carry `py-2.5 text-base`.

- [ ] **Step 3: Add the compact class and switch the admin components**

In `Field.tsx`, after the `inputCls` export (line 14), add:

```ts
/**
 * Compact admin density (~38px tall, 14px text) for the back-office
 * workbench. `inputCls` stays the larger storefront-sized control for the
 * checkout/login/account importers.
 */
export const inputClsCompact =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";
```

Change `TextInput` (line 55), `Select` (line 67) and `Textarea` (line 77) to use `${inputClsCompact} ${className}`.trim().

- [ ] **Step 4: Switch ImageUrlInput to the compact class**

In `ImageUrlInput.tsx`:

- Line 4: `import { inputCls } from "./Field";` → `import { inputClsCompact } from "./Field";`
- Line 6: `const MAX_IMAGE_BYTES` → `export const MAX_IMAGE_BYTES`
- Line 22: `const ACCEPT_ATTRS` → `export const ACCEPT_ATTRS`
- Line 156 (video thumb) and line 163 (image thumb): `h-11 w-11` → `h-9 w-9`
- Line 172: `` className={`${inputCls} min-w-0 flex-1`} `` → `` className={`${inputClsCompact} min-w-0 flex-1`} ``
- Line 186 (upload button): `h-11` → `h-9`

- [ ] **Step 5: Switch VariantMatrix to the compact class**

In `VariantMatrix.tsx`:

- Line 4: `import { inputCls } from "@/components/admin/Field";` → `import { inputClsCompact } from "@/components/admin/Field";`
- Replace `inputCls` with `inputClsCompact` at lines 235, 253, 370, 384, 406, 430, 458 (all are `` `${inputCls} w-…` `` template literals).

- [ ] **Step 6: Run the targeted tests**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/Field.spec.tsx src/components/admin/ImageUrlInput.spec.ts src/components/admin/ImageUrlInput.labels.spec.tsx src/components/admin/VariantMatrix.spec.tsx`

Expected: PASS (4 files).

- [ ] **Step 7: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/Field.tsx \
  small-house-commerce/frontend/src/components/admin/Field.spec.tsx \
  small-house-commerce/frontend/src/components/admin/ImageUrlInput.tsx \
  small-house-commerce/frontend/src/components/admin/VariantMatrix.tsx
git commit -m "feat(admin): compact admin form control density"
```

---

### Task 2: Workbench grid, fixed 280px rail, and section spacing

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.tsx` (lines 1486, 1491)
- Test: `small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing later tasks import; the grid class is the observable.

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe("ProductForm problem rail", …)` block in `ProductForm.spec.tsx` (or any existing describe; it only needs `renderForm` and `baseValue`):

```tsx
it("gives the editing column the remaining width beside a fixed 280px rail", () => {
  const { container } = renderForm(baseValue());

  const panel = container.querySelector("#pf-panel-basic");
  expect(panel).not.toBeNull();
  expect(panel).toHaveClass("gap-6");
  const grid = panel?.parentElement;
  expect(grid).toHaveClass("xl:grid-cols-[minmax(0,1fr)_280px]");
  expect(grid?.querySelector("aside")).not.toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/ProductForm.spec.tsx -t "remaining width"`

Expected: FAIL — the grid currently has `xl:grid-cols-[minmax(0,72fr)_minmax(20rem,28fr)]` and the panel gap is `gap-8`.

- [ ] **Step 3: Change the grid and the section gap**

In `ProductForm.tsx` line 1486, replace:

```tsx
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,72fr)_minmax(20rem,28fr)]">
```

with:

```tsx
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
```

In `ProductForm.tsx` line 1491, replace `className="flex min-w-0 flex-col gap-8"` with `className="flex min-w-0 flex-col gap-6"` (section gap 32px → 24px, matching the approved density scale).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/ProductForm.spec.tsx`

Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/ProductForm.tsx \
  small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx
git commit -m "feat(admin): widen product editing column beside fixed rail"
```

---

### Task 3: Compact thumbnail grid with hover actions

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.tsx` (lines 24–25, 133–317)
- Test: `small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.spec.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: card markup contract consumed by Task 4's spec: each card renders `[data-media-actions]` containing buttons named `Move media {n} left`, `Move media {n} right`, `Set as cover` (non-cover cards only), `Remove media`.

- [ ] **Step 1: Write the failing test**

In `SharedMediaWorkspace.spec.tsx`, update the grid-class assertion in the first test (currently lines 67–69) from:

```tsx
    expect(list).toHaveClass(
      "grid-cols-[repeat(auto-fill,minmax(140px,160px))]",
    );
```

to:

```tsx
    expect(list).toHaveClass(
      "grid-cols-[repeat(auto-fill,minmax(88px,104px))]",
    );
```

And add a new test after the first one:

```tsx
  it("reveals per-card actions on hover and focus without removing them from the DOM", () => {
    renderWorkspace();

    const actions = document.querySelectorAll("[data-media-actions]");
    expect(actions).toHaveLength(3);
    for (const action of actions) {
      expect(action).toHaveClass(
        "opacity-0",
        "group-hover:opacity-100",
        "group-focus-within:opacity-100",
      );
    }
    expect(
      screen.getAllByRole("button", { name: "Remove media" }),
    ).toHaveLength(3);
    expect(
      screen.getAllByRole("button", { name: "Move media 1 right" }),
    ).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/product-form/SharedMediaWorkspace.spec.tsx`

Expected: FAIL — the grid class is still the 140/160 one and no `[data-media-actions]` element exists.

- [ ] **Step 3: Implement the compact grid and hover overlay**

In `SharedMediaWorkspace.tsx`:

Replace the `compactActionCls` constant (lines 24–25) with:

```ts
const overlayActionCls =
  "inline-flex h-6 min-w-6 items-center justify-center rounded bg-white/90 px-1 text-[11px] font-semibold text-ink hover:bg-white disabled:cursor-not-allowed disabled:opacity-40";
```

Change the list class (line 135) to:

```tsx
          className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(88px,104px))] justify-start gap-2"
```

Inside the card `<li>` (line 172), change the class to add the group/relative markers:

```tsx
                className={`group relative overflow-hidden rounded-lg bg-background ${
                  highlighted || isCover
                    ? "ring-2 ring-cta ring-offset-1"
                    : "border border-border"
                }`}
```

Inside the thumbnail button, move the order badge to the top-left and shrink both badges:

```tsx
                    <span className="absolute left-1 top-1 rounded-full bg-ink/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {t("product_media_order", { position: index + 1 })}
                    </span>
                    {isCover ? (
                      <span className="absolute right-1 top-1 rounded-full bg-cta px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {t("product_media_cover")}
                      </span>
                    ) : null}
```

Delete the always-visible action row `<div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1.5">…</div>` (lines 246–311) and put its four actions into an overlay as a sibling of the thumbnail button, inside the inner `<div>`:

```tsx
                  <div
                    data-media-actions
                    className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-ink/70 px-0.5 py-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                  >
                    <button
                      type="button"
                      className={overlayActionCls}
                      onClick={() => {
                        setActiveIndex((current) =>
                          indexAfterMove(current, index, index - 1),
                        );
                        onMove(index, -1);
                      }}
                      disabled={pending || index === 0}
                      aria-label={t("product_media_move_left", {
                        number: index + 1,
                      })}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className={overlayActionCls}
                      onClick={() => {
                        setActiveIndex((current) =>
                          indexAfterMove(current, index, index + 1),
                        );
                        onMove(index, 1);
                      }}
                      disabled={pending || index === images.length - 1}
                      aria-label={t("product_media_move_right", {
                        number: index + 1,
                      })}
                    >
                      →
                    </button>
                    {!isCover ? (
                      <button
                        type="button"
                        className={overlayActionCls}
                        onClick={() => {
                          setActiveIndex((current) =>
                            indexAfterMove(current, index, 0),
                          );
                          onSetCover(index);
                        }}
                        disabled={pending}
                        aria-label={t("product_media_set_cover")}
                      >
                        ★
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={overlayActionCls}
                      onClick={() => {
                        setActiveIndex((current) => {
                          if (current === null) return null;
                          if (current === index) return null;
                          return current > index ? current - 1 : current;
                        });
                        onRemove(index);
                      }}
                      disabled={pending}
                      aria-label={t("product_media_remove")}
                    >
                      ✕
                    </button>
                  </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/product-form/SharedMediaWorkspace.spec.tsx`

Expected: PASS (all tests, including the four pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.tsx \
  small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.spec.tsx
git commit -m "feat(admin): compact media grid with hover actions"
```

---

### Task 4: Batch image upload and URL add row

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/product-form/MediaAddRow.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/product-form/MediaAddRow.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.tsx` (props + header area)
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.tsx` (helper + handler + `sharedMedia` props)
- Modify: `small-house-commerce/frontend/src/i18n/en.ts` (after `product_media_add_video`, line 513)
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts` (after `product_media_add_video`, line 509)
- Test: `small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx`, `SharedMediaWorkspace.spec.tsx`

**Interfaces:**
- Consumes: `inputClsCompact` (Task 1), `MAX_IMAGE_BYTES`, `ACCEPT_ATTRS`, `resolveUploadType` (Task 1 exports).
- Produces: `MediaAddRow({ disabled?: boolean; onAddImageUrl: (url: string) => void })`; `SharedMediaWorkspaceProps.onAddImageUrl: (url: string) => void` (required); `appendImageUrl(images: ImageFormValue[], url: string): ImageFormValue[]` exported from `ProductForm.tsx`.

- [ ] **Step 1: Add the i18n keys**

In `en.ts` after `product_media_add_video: "Add video",` add:

```ts
  product_media_batch_upload: "Upload photos",
  product_media_batch_uploading: "Uploading {done}/{total}…",
  product_media_batch_input_aria: "Choose images to upload",
  product_media_batch_invalid_type: "Only JPG / PNG / WebP images are supported",
  product_media_batch_too_large: "Images must be 5MB or smaller",
  product_media_batch_upload_failed: "Upload failed, please retry",
  product_media_batch_failure: "{name}: {reason}",
  product_media_url_add: "Add URL",
  product_media_url_add_aria: "Image URL to add",
```

In `zh.ts` after `product_media_add_video: "添加视频",` add:

```ts
  product_media_batch_upload: "上传图片（可多选）",
  product_media_batch_uploading: "上传中 {done}/{total}…",
  product_media_batch_input_aria: "选择要批量上传的图片",
  product_media_batch_invalid_type: "仅支持 JPG / PNG / WebP 图片",
  product_media_batch_too_large: "图片不能超过 5MB",
  product_media_batch_upload_failed: "上传失败，请重试",
  product_media_batch_failure: "{name}：{reason}",
  product_media_url_add: "添加",
  product_media_url_add_aria: "要添加的图片 URL",
```

- [ ] **Step 2: Write the failing test for MediaAddRow**

Create `MediaAddRow.spec.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { MediaAddRow } from "@/components/admin/product-form/MediaAddRow";

const uploadImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { uploadImage } }));

function file(name: string, type = "image/jpeg", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

function renderRow(onAddImageUrl = vi.fn()) {
  const view = render(
    <AdminI18nProvider>
      <MediaAddRow onAddImageUrl={onAddImageUrl} />
    </AdminI18nProvider>,
  );
  return { ...view, onAddImageUrl };
}

beforeEach(() => {
  setAdminLang("en");
  uploadImage.mockReset();
});

describe("MediaAddRow", () => {
  it("uploads several files in picker order and appends each URL", async () => {
    uploadImage
      .mockResolvedValueOnce({ url: "/uploads/a.jpg" })
      .mockResolvedValueOnce({ url: "/uploads/b.jpg" })
      .mockResolvedValueOnce({ url: "/uploads/c.jpg" });
    const { onAddImageUrl } = renderRow();

    fireEvent.change(screen.getByLabelText("Choose images to upload"), {
      target: { files: [file("a.jpg"), file("b.jpg"), file("c.jpg")] },
    });

    await waitFor(() => expect(onAddImageUrl).toHaveBeenCalledTimes(3));
    expect(uploadImage).toHaveBeenNthCalledWith(1, expect.any(File), "image/jpeg");
    expect(onAddImageUrl.mock.calls.map((call) => call[0])).toEqual([
      "/uploads/a.jpg",
      "/uploads/b.jpg",
      "/uploads/c.jpg",
    ]);
  });

  it("reports one failed file and still appends the others", async () => {
    uploadImage
      .mockResolvedValueOnce({ url: "/uploads/ok-1.jpg" })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ url: "/uploads/ok-2.jpg" });
    const { onAddImageUrl } = renderRow();

    fireEvent.change(screen.getByLabelText("Choose images to upload"), {
      target: { files: [file("ok-1.jpg"), file("bad.jpg"), file("ok-2.jpg")] },
    });

    await waitFor(() => expect(onAddImageUrl).toHaveBeenCalledTimes(2));
    expect(onAddImageUrl.mock.calls.map((call) => call[0])).toEqual([
      "/uploads/ok-1.jpg",
      "/uploads/ok-2.jpg",
    ]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("bad.jpg");
  });

  it("rejects an oversized file without calling the upload endpoint", async () => {
    const { onAddImageUrl } = renderRow();

    fireEvent.change(screen.getByLabelText("Choose images to upload"), {
      target: { files: [file("huge.jpg", "image/jpeg", 6 * 1024 * 1024)] },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("huge.jpg");
    expect(uploadImage).not.toHaveBeenCalled();
    expect(onAddImageUrl).not.toHaveBeenCalled();
  });

  it("adds a pasted image URL and clears the draft", () => {
    const { onAddImageUrl } = renderRow();

    const urlInput = screen.getByLabelText("Image URL to add");
    fireEvent.change(urlInput, {
      target: { value: "https://cdn.example.com/x.jpg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add URL" }));

    expect(onAddImageUrl).toHaveBeenCalledWith("https://cdn.example.com/x.jpg");
    expect(urlInput).toHaveValue("");
  });

  it("disables both add paths while editing is pending", () => {
    render(
      <AdminI18nProvider>
        <MediaAddRow disabled onAddImageUrl={vi.fn()} />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Upload photos" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add URL" })).toBeDisabled();
    expect(screen.getByLabelText("Choose images to upload")).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/product-form/MediaAddRow.spec.tsx`

Expected: FAIL — `MediaAddRow` does not exist.

- [ ] **Step 4: Implement MediaAddRow**

Create `MediaAddRow.tsx`:

```tsx
"use client";

import { useRef, useState, type ReactNode } from "react";
import { TextInput } from "@/components/admin/Field";
import {
  ACCEPT_ATTRS,
  MAX_IMAGE_BYTES,
  resolveUploadType,
} from "@/components/admin/ImageUrlInput";
import { useAdminI18n } from "@/lib/admin-i18n";

type BatchFailure = { name: string; reason: string };

/**
 * One compact row for adding images to the shared gallery: pick several local
 * files at once (sequential uploads through the existing single-file endpoint,
 * failures reported per file and never aborting the batch), or paste a public
 * image URL. Every success appends through `onAddImageUrl` in picker order.
 */
export function MediaAddRow({
  disabled = false,
  onAddImageUrl,
}: {
  disabled?: boolean;
  onAddImageUrl: (url: string) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [failures, setFailures] = useState<BatchFailure[]>([]);
  const [urlDraft, setUrlDraft] = useState("");

  async function handleFiles(files: FileList | null): Promise<void> {
    const picked = files ? Array.from(files) : [];
    if (picked.length === 0) return;
    setFailures([]);
    setProgress({ done: 0, total: picked.length });
    // Lazy import keeps the admin API module out of non-upload bundles.
    const { adminApi } = await import("@/lib/admin-api");
    let done = 0;
    for (const file of picked) {
      const contentType = resolveUploadType(file.name, file.type, "image");
      if (!contentType) {
        setFailures((current) => [
          ...current,
          { name: file.name, reason: t("product_media_batch_invalid_type") },
        ]);
      } else if (file.size > MAX_IMAGE_BYTES) {
        setFailures((current) => [
          ...current,
          { name: file.name, reason: t("product_media_batch_too_large") },
        ]);
      } else {
        try {
          const res = await adminApi.uploadImage(file, contentType);
          onAddImageUrl(res.url);
        } catch {
          setFailures((current) => [
            ...current,
            { name: file.name, reason: t("product_media_batch_upload_failed") },
          ]);
        }
      }
      done += 1;
      setProgress({ done, total: picked.length });
    }
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const busy = progress !== null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-cta/40 px-3 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy}
        >
          {busy
            ? t("product_media_batch_uploading", {
                done: progress.done,
                total: progress.total,
              })
            : t("product_media_batch_upload")}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRS.image}
          className="hidden"
          aria-label={t("product_media_batch_input_aria")}
          disabled={disabled || busy}
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <div className="flex min-w-48 flex-1 items-center gap-2">
          <TextInput
            aria-label={t("product_media_url_add_aria")}
            value={urlDraft}
            placeholder="https://…"
            onChange={(event) => setUrlDraft(event.target.value)}
            disabled={disabled}
            autoComplete="off"
          />
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-border px-3 text-sm font-semibold text-ink-secondary hover:border-primary hover:text-ink disabled:cursor-not-allowed disabled:text-ink-muted"
            onClick={() => {
              const url = urlDraft.trim();
              if (!url) return;
              onAddImageUrl(url);
              setUrlDraft("");
            }}
            disabled={disabled || urlDraft.trim() === ""}
          >
            {t("product_media_url_add")}
          </button>
        </div>
      </div>
      {failures.length > 0 ? (
        <ul role="alert" className="text-xs text-red-700">
          {failures.map((failure) => (
            <li key={failure.name}>
              {t("product_media_batch_failure", {
                name: failure.name,
                reason: failure.reason,
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run the MediaAddRow tests**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/product-form/MediaAddRow.spec.tsx`

Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing wiring tests**

In `SharedMediaWorkspace.spec.tsx`, add `onAddImageUrl: vi.fn()` to the `renderWorkspace` default props (after `onAdd: vi.fn(),`), and add:

```tsx
  it("forwards the add row to the gallery owner", () => {
    const { props } = renderWorkspace();

    fireEvent.change(screen.getByLabelText("Image URL to add"), {
      target: { value: "https://cdn.example.com/new.jpg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add URL" }));

    expect(props.onAddImageUrl).toHaveBeenCalledWith(
      "https://cdn.example.com/new.jpg",
    );
  });
```

In `ProductForm.spec.tsx`, extend the import from `@/components/admin/ProductForm` with `appendImageUrl`, and add:

```tsx
describe("ProductForm media add helpers", () => {
  it("appends an uploaded image row with the next sort order", () => {
    const rows = appendImageUrl([], "/uploads/a.jpg");
    expect(rows).toEqual([
      { url: "/uploads/a.jpg", type: "IMAGE", altText: "", sortOrder: "0" },
    ]);

    const next = appendImageUrl(rows, "/uploads/b.jpg");
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      url: "/uploads/b.jpg",
      type: "IMAGE",
      altText: "",
      sortOrder: "1",
    });
  });
});
```

- [ ] **Step 7: Run the wiring tests to verify they fail**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/product-form/SharedMediaWorkspace.spec.tsx src/components/admin/ProductForm.spec.tsx -t "add row"`

Expected: FAIL — `onAddImageUrl` prop and `appendImageUrl` do not exist.

- [ ] **Step 8: Wire the prop and helper**

In `SharedMediaWorkspace.tsx`:

- Import the new row: `import { MediaAddRow } from "@/components/admin/product-form/MediaAddRow";`
- Add to `SharedMediaWorkspaceProps` after `onAdd`:

```ts
  onAddImageUrl: (url: string) => void;
```

- Destructure `onAddImageUrl` in the component signature, and render the row between the header block and the empty/grid branch (after the closing `</div>` of the summary header at line 126):

```tsx
      <MediaAddRow disabled={pending} onAddImageUrl={onAddImageUrl} />
```

In `ProductForm.tsx`:

- After `appendImage` (line 163), add:

```ts
/** Appends an image row that already carries its uploaded/pasted URL. */
export function appendImageUrl(
  images: ImageFormValue[],
  url: string,
): ImageFormValue[] {
  return [
    ...images,
    { url, type: "IMAGE", altText: "", sortOrder: String(images.length) },
  ];
}
```

- After the `addImage` handler (line 1063), add:

```ts
  const addImageWithUrl = (url: string): void => {
    setValue((prev) => ({
      ...prev,
      images: appendImageUrl(prev.images, url),
    }));
    clearValidation();
  };
```

- In the `sharedMedia` props object (line 1716), add after `onAdd: addImage,`:

```ts
              onAddImageUrl: addImageWithUrl,
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/product-form/MediaAddRow.spec.tsx src/components/admin/product-form/SharedMediaWorkspace.spec.tsx src/components/admin/ProductForm.spec.tsx`

Expected: PASS (3 files).

- [ ] **Step 10: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/product-form/MediaAddRow.tsx \
  small-house-commerce/frontend/src/components/admin/product-form/MediaAddRow.spec.tsx \
  small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.tsx \
  small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.spec.tsx \
  small-house-commerce/frontend/src/components/admin/ProductForm.tsx \
  small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx \
  small-house-commerce/frontend/src/i18n/en.ts small-house-commerce/frontend/src/i18n/zh.ts
git commit -m "feat(admin): batch image upload and URL add row"
```

---

### Task 5: Scrollable live preview

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/PreviewPane.tsx` (lines 206–234, `LivePreview`)
- Test: `small-house-commerce/frontend/src/components/admin/product-form/ProductPreviewPanel.spec.tsx`

**Interfaces:**
- Consumes: existing `DeviceFrame` `scrollable` prop (unchanged).
- Produces: `[data-preview-scroll]` wrapper inside every `LivePreview` frame; `DeviceFrame` viewport gets `relative` positioning when `scrollable`.

- [ ] **Step 1: Write the failing test**

In `ProductPreviewPanel.spec.tsx` add:

```tsx
  it("scrolls the full page inside the live preview frames", () => {
    renderPanel(null);

    const scrollers = document.querySelectorAll("[data-preview-scroll]");
    expect(scrollers).toHaveLength(2);
    for (const scroller of scrollers) {
      expect(scroller).toHaveClass("h-full", "overflow-y-auto");
    }
    for (const viewport of document.querySelectorAll("[data-preview-viewport]")) {
      expect(viewport).toHaveClass("relative");
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/product-form/ProductPreviewPanel.spec.tsx -t "scrolls the full page"`

Expected: FAIL — no `[data-preview-scroll]` element exists and the viewport is `absolute`.

- [ ] **Step 3: Implement the scroll wrapper**

In `PreviewPane.tsx`, replace the `LivePreview` body (lines 217–233) with:

```tsx
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-ink-muted">{labels.liveNote}</p>
      <PreviewRow>
        <DeviceFrame
          device="desktop"
          labels={labels}
          className={preferMobileOnNarrow ? "max-[719px]:hidden" : undefined}
          scrollable
        >
          <div data-preview-scroll className="h-full overflow-y-auto">
            {children}
          </div>
        </DeviceFrame>
        <DeviceFrame device="mobile" labels={labels} scrollable>
          <div data-preview-scroll className="h-full overflow-y-auto">
            {children}
          </div>
        </DeviceFrame>
      </PreviewRow>
    </div>
  );
```

- [ ] **Step 4: Run the affected specs**

Run: `pnpm --dir small-house-commerce/frontend test --run src/components/admin/product-form/ProductPreviewPanel.spec.tsx src/components/admin/CollectionsPanel.spec.tsx src/components/admin/CategoriesPanel.spec.tsx src/components/admin/homepage/HomepageEditor.spec.tsx`

Expected: PASS — the new test passes and the collections/categories/homepage consumers are unaffected.

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/PreviewPane.tsx \
  small-house-commerce/frontend/src/components/admin/product-form/ProductPreviewPanel.spec.tsx
git commit -m "fix(admin): scroll the full page inside live preview frames"
```

---

### Task 6: Full verification, browser acceptance, and review

**Files:** none created; verification only (fixes, if any, get their own RED→GREEN test and commit).

- [ ] **Step 1: Run the full frontend suite**

Run: `pnpm --dir small-house-commerce/frontend test`

Expected: all test files pass. Record the file/test counts.

- [ ] **Step 2: Typecheck, lint, build**

Run:

```bash
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/frontend build
```

Expected: tsc clean; lint 0 errors (the one pre-existing `admin-i18n.tsx` warning is acceptable and must be reported); build succeeds.

- [ ] **Step 3: Start the isolated rehearsal services**

Backend (background):

```bash
PORT=3002 HOST=127.0.0.1 DATABASE_URL='postgresql://postgres:postgres@localhost:5432/small_house_homepage_rehearsal?schema=public' JWT_SECRET='local-homepage-builder-verification-secret-2026' HOMEPAGE_PREVIEW_SECRET='local-homepage-preview-secret-2026-abcdef' pnpm --dir small-house-commerce/backend start:dev
```

Frontend (background):

```bash
API_TARGET='http://127.0.0.1:3002' NEXT_TELEMETRY_DISABLED=1 pnpm --dir small-house-commerce/frontend exec next dev -p 3005
```

Do not touch ports 3000/3001.

- [ ] **Step 4: Browser acceptance with Chrome DevTools MCP**

Prepare three small test PNGs (any tiny valid PNG bytes) in `/tmp/luwag-upload-test/` for the batch picker.

Verify on `http://localhost:3005/admin/products/new` and one existing product's edit page, at 1280px and 1440px widths:

1. Editing column is visibly wider; rail is 280px; sticky header still works; no horizontal overflow.
2. Inputs render at the compact height; short fields still pair correctly.
3. Media tab: click the batch upload button, pick all three files, confirm they upload sequentially and append in order with a single visible cover badge; hover a thumbnail to reveal ←/→/★/✕; drag to reorder; set cover; click a thumbnail and edit Alt; remove one.
4. Preview tab: scroll the desktop frame and the mobile frame through the full product page; confirm the outer admin page stays at `window.scrollY === 0` while the frame content scrolls; confirm the saved (iframe) preview also scrolls.
5. Console: no errors or hydration warnings.

- [ ] **Step 5: Run the product editor E2E**

Run: `pnpm --dir small-house-commerce/frontend exec playwright test e2e/admin-product-editor.spec.ts --project=chromium`

Expected: PASS. (Uses the existing disposable E2E database/global setup; never production.)

- [ ] **Step 6: Fresh-context review**

Dispatch one reviewer subagent (most capable model) with the branch diff range for this sub-project (`git merge-base main HEAD` → HEAD) plus the spec path and the Review Focus list. Fix every Critical/Important finding with a RED→GREEN test and re-run the full suite; record Minor findings without fixing. Commit each fix separately.

- [ ] **Step 7: Final report**

Report: commit list, full-suite counts, tsc/lint/build results, browser observations per device width, E2E result, review findings and their outcomes. State explicitly that nothing was pushed, merged, or deployed, and that `backend/uploads/` was not committed.
