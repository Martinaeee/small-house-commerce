import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { en } from "@/i18n/en";
import { emptyProductFormValue, emptySkuFormValue } from "@/components/admin/ProductForm";
import { cardGraphFromLegacyForm, type AdminCatalogGraphDraft } from "@/lib/admin-product-graph";
import { GraphDraftHarness, draftJson } from "@/test/harness";
import { ProductCardMediaEditor } from "./ProductCardMediaEditor";
import type { MediaBatchUpload } from "./useMediaBatchUpload";

function fixture(): AdminCatalogGraphDraft {
  const value = emptyProductFormValue();
  value.graphTyped = false;
  value.variants = ["Red", "Blue"].map(name => ({ id: name.toLowerCase(), name, position: "0",
    sku: { ...emptySkuFormValue(), id: `${name}-sku`, skuCode: name, price: "0" },
  }));
  value.images = [
    { id: "photo", url: "/uploads/shared.webp", type: "IMAGE", altText: "Shared gallery", sortOrder: "0", isScene: true },
    { id: "movie", url: "/uploads/video.mp4", type: "VIDEO", altText: "Movie", sortOrder: "1" },
  ];
  return cardGraphFromLegacyForm(value);
}

function renderEditor({ initial = fixture(), pending = false, uploading = false, results = {} as MediaBatchUpload["results"] } = {}) {
  const onPreviewVariant = vi.fn();
  const upload = vi.fn<MediaBatchUpload["upload"]>(async (_files, target) => {
    target.onAddMedia({ type: "IMAGE", url: "/uploads/new.webp" });
  });
  const batchUpload: MediaBatchUpload = { results, uploading, targetKey: null, upload, dismiss: vi.fn() };
  render(<AdminI18nProvider><GraphDraftHarness initial={initial} render={(draft, onChange) => (
    <ProductCardMediaEditor draft={draft} onChange={onChange} batchUpload={batchUpload}
      pending={pending} onPreviewVariant={onPreviewVariant} />
  )} /></AdminI18nProvider>);
  return { upload, onPreviewVariant };
}

function current(): AdminCatalogGraphDraft {
  return draftJson() as AdminCatalogGraphDraft;
}

async function choose(slot = "Card cover") {
  const user = userEvent.setup();
  const trigger = screen.queryByRole("button", { name: `Red ${slot}: Choose from gallery` });
  expect(trigger).toBeInTheDocument();
  await user.click(trigger!);
  expect(screen.getByRole("dialog", { name: "Choose a product card image" })).toBeInTheDocument();
  expect(screen.queryByAltText("Movie")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Choose image 1" }));
}

describe("ProductCardMediaEditor", () => {
  beforeEach(() => { setAdminLang("en"); });

  it("copies a gallery snapshot only to the addressed variant without reordering or marking the gallery", async () => {
    const initial = fixture();
    const gallery = structuredClone(initial.media);
    renderEditor({ initial });
    await choose();
    expect(current().variants[0]).toHaveProperty("cardMedia", {
      cover: { type: "IMAGE", url: "/uploads/shared.webp", altText: "Shared gallery" }, hover: null,
    });
    expect(current().variants[1]!.cardMedia ?? null).toBeNull();
    expect(current().media).toEqual(gallery);
    expect(current().defaultDisplayVariantRef).toBeNull();
  });

  it("clears hover independently and edits alt text without changing the cover URL", async () => {
    renderEditor();
    await choose();
    await choose("Hover image");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Red Hover image: Clear" }));
    const alt = screen.getByRole("textbox", { name: "Red Card cover: Alt text" });
    await user.clear(alt);
    await user.type(alt, "Independent alt");
    expect(current().variants[0]).toHaveProperty("cardMedia", {
      cover: { type: "IMAGE", url: "/uploads/shared.webp", altText: "Independent alt" }, hover: null,
    });
    expect(current().media[0]!.altText).toBe("Shared gallery");
  });

  it("uses one IMAGE-only REPLACE upload target for the real variant identity", async () => {
    const { upload } = renderEditor();
    const input = screen.queryByLabelText("Red Card cover: Upload image");
    expect(input).toBeInTheDocument();
    expect(input).not.toHaveAttribute("multiple");
    await userEvent.upload(input!, new File(["image"], "own.webp", { type: "image/webp" }));
    expect(upload).toHaveBeenCalledWith([expect.any(File)], expect.objectContaining({
      key: "card:red:cover", kind: "image", operation: "REPLACE",
    }));
    expect(current().variants[0]).toHaveProperty("cardMedia.cover.url", "/uploads/new.webp");
    expect(current().variants[1]!.cardMedia ?? null).toBeNull();
    expect(current().media).toHaveLength(2);
  });

  it("keeps preview selection independent from an explicit saved default", async () => {
    const { onPreviewVariant } = renderEditor();
    const user = userEvent.setup();
    const preview = screen.queryByRole("button", { name: "Red Preview this variant" });
    expect(preview).toBeInTheDocument();
    await user.click(preview!);
    expect(onPreviewVariant).toHaveBeenCalledWith({ id: "red" });
    expect(current().defaultDisplayVariantRef).toBeNull();
    await user.click(screen.getByRole("button", { name: "Blue Set as default" }));
    expect(current().defaultDisplayVariantRef).toEqual({ id: "blue" });
  });

  it.each([{ pending: true }, { uploading: true }])("locks image edits and identity choices while busy %j", flags => {
    renderEditor(flags);
    expect(screen.queryByRole("button", { name: "Red Card cover: Choose from gallery" })).toBeDisabled();
    expect(screen.queryByLabelText("Red Card cover: Upload image")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Red Set as default" })).toBeDisabled();
  });

  it("reuses the existing collapsed upload receipt without exposing another slot's records", async () => {
    renderEditor({ results: { "card:red:cover": [
      { operation: "REPLACE", name: "own.webp", status: "uploaded" },
    ] } });
    expect(screen.queryByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("own.webp")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: en.product_media_batch_details }));
    expect(screen.getByRole("list", { name: en.product_media_batch_queue })).toHaveTextContent("own.webp");
    expect(current().variants[1]!.cardMedia ?? null).toBeNull();
  });

  it("renders exactly two slots for a single real variant", () => {
    const initial = fixture();
    initial.variants = initial.variants.slice(0, 1);
    renderEditor({ initial });
    expect(screen.queryAllByRole("button", { name: /Choose from gallery/ })).toHaveLength(2);
  });
});
