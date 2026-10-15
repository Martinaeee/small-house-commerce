import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Config, Data } from "@puckeditor/core";
import MarketingCanvas from "./MarketingCanvas";
import { marketingPuckConfig } from "./puck-config";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { marketingApi } from "@/lib/marketing-api";
import { adminApi } from "@/lib/admin-api";
import type { Product } from "@/lib/api";
import type { LandingBlock, LandingContent, LandingMedia, MarketingEditorData, MarketingEditorProps, MarketingEditorRoot } from "@/lib/marketing-content";
import { zh } from "@/i18n/zh";
interface CanvasBoundary {
  config: Config<MarketingEditorProps, Partial<MarketingEditorRoot>>;
  data: MarketingEditorData;
  onChange: (data: Data<MarketingEditorProps, Partial<MarketingEditorRoot>>) => void;
}
const boundary = vi.hoisted(() => ({ data: null as MarketingEditorData | null }));
vi.mock("@puckeditor/core", () => ({
  Puck: (props: CanvasBoundary) => {
    boundary.data = props.data;
    const block = props.data.content.find(item => item.type === "gallery");
    const field = props.config.components.gallery.fields!.media;
    return block && field.type === "custom" ? field.render({ id: "media-field", name: "media", value: block.props.media, readOnly: false, field, onChange: (media: LandingMedia[]) => props.onChange({ ...props.data, content: props.data.content.map(item => item.type === "gallery" && item.props.id === block.props.id ? { ...item, props: { ...item.props, media } } : item) }) }) : <div>No media block</div>;
  },
  usePuck: () => ({ selectedItem: boundary.data?.content.find(item => item.type === "gallery"), getItemById: (id: string) => boundary.data?.content.find(item => item.props.id === id) }),
}));
const gallery: Extract<LandingBlock, { type: "gallery" }> = { id: "gallery", type: "gallery", sourceKey: "gallery:p1", props: { media: [] } };
const buy: Extract<LandingBlock, { type: "buy" }> = { id: "buy", type: "buy", sourceKey: null, props: {} };
const base: LandingContent = { schemaVersion: 1, seoTitle: null, seoDescription: null, startAt: null, endAt: null, blocks: [gallery, buy] };
const product: Product = { id: "p1", name: "Saved chair", slug: "chair", description: null, tagline: null, categoryId: "category-1", ratingAverage: null, reviewCount: 0, room: null, internalRole: null, solutions: [], width: null, height: null, depth: null, foldedWidth: null, foldedHeight: null, foldedDepth: null, catalogGraphVersion: 0, defaultDisplayVariantId: null, effectiveCoverMedia: null, images: [], variants: [{ id: "variant-red", name: "Red chair", position: 0, combinationKey: "color:oval-red", optionValueIds: ["oval-red"], sku: { id: "sku-red", skuCode: "SKU-RED", status: "ACTIVE", price: 100, compareAtPrice: null, availableInventory: 7 } }], options: [{ id: "color", name: "Color", kind: "COLOR", position: 0, presentation: "TEXT", isMediaDriver: true, values: [{ id: "oval-red", label: "Red", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null }] }] };
const image: LandingMedia = { url: "/uploads/saved.jpg", type: "IMAGE", altText: "Saved image", optionValueId: null, variantId: null };
const source: LandingContent = { ...base, blocks: [{ ...gallery, props: { media: [image] } }, buy] };
function Harness({ initial = base, onUploadingChange = () => {} }: { initial?: LandingContent; onUploadingChange?: (pending: boolean) => void }) {
  const [content, setContent] = useState(structuredClone(initial));
  return <AdminI18nProvider><button onClick={() => setContent(current => ({ ...current, blocks: current.blocks.filter(block => block.id !== "gallery") }))}>Delete media block</button><MarketingCanvas pageId="page-1" content={content} approvedContent={initial} validatedPreview={null} product={product} readOnly={false} onChange={setContent} onUploadingChange={onUploadingChange} /><output data-testid="document">{JSON.stringify(content)}</output></AdminI18nProvider>;
}
const documentValue = () => JSON.parse(screen.getByTestId("document").textContent!) as LandingContent;
const mediaValue = () => (documentValue().blocks[0] as Extract<LandingBlock, { type: "gallery" }>).props.media;
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); setAdminLang("zh"); vi.spyOn(marketingApi, "source").mockResolvedValue({ content: source, sourceContentHash: "saved", changed: true }); vi.spyOn(marketingApi, "saveDraft"); vi.spyOn(marketingApi, "publish"); });
it("uses one controlled media workspace for gallery and detail rather than raw UUID array fields", () => {
  const config = marketingPuckConfig(() => null, key => zh[key]);
  for (const type of ["gallery", "detail"] as const) expect(config.components[type].fields!.media.type).toBe("custom");
});
it("selects media from the saved mother source without syncing or writing either document", async () => {
  const before = structuredClone(product); render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "选择母商品已保存媒体" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /Saved image/ }));
  fireEvent.click(screen.getByRole("button", { name: "添加所选媒体" }));
  expect(mediaValue()).toEqual([image]);
  expect(marketingApi.source).toHaveBeenCalledWith("page-1"); expect(marketingApi.saveDraft).not.toHaveBeenCalled(); expect(marketingApi.publish).not.toHaveBeenCalled(); expect(product).toEqual(before);
});
it("uses saved labels and keeps value/variant bindings mutually exclusive", () => {
  render(<Harness initial={source} />);
  const select = screen.getByLabelText("媒体 1 范围");
  expect(screen.getByRole("option", { name: "Color · Red" })).toBeInTheDocument(); expect(screen.getByRole("option", { name: "Red chair" })).toBeInTheDocument();
  fireEvent.change(select, { target: { value: "VALUE:oval-red" } }); expect(mediaValue()[0]).toMatchObject({ optionValueId: "oval-red", variantId: null });
  fireEvent.change(select, { target: { value: "VARIANT:variant-red" } }); expect(mediaValue()[0]).toMatchObject({ optionValueId: null, variantId: "variant-red" });
});
it("preserves an unavailable old binding and exposes a diagnosis instead of replacing its SKU", () => {
  const bound = { ...image, variantId: "retired-variant" }; render(<Harness initial={{ ...base, blocks: [{ ...gallery, props: { media: [bound] } }, buy] }} />);
  expect(screen.getByText(/原绑定已不可用/)).toBeInTheDocument(); expect(screen.getByLabelText("媒体 1 范围")).toHaveValue("VARIANT:retired-variant");
  expect(mediaValue()[0]).toEqual(bound);
});
it("reuses the mixed bulk uploader with page ownership and preserves all successful files", async () => {
  const global = vi.spyOn(adminApi, "uploadImage"); const notify = vi.fn();
  const upload = vi.spyOn(marketingApi, "uploadMedia").mockResolvedValueOnce({ url: "/uploads/one.jpg", key: "one" }).mockResolvedValueOnce({ url: "/uploads/two.mp4", key: "two" });
  render(<Harness onUploadingChange={notify} />);
  const files = [new File(["a"], "one.jpg", { type: "" }), new File(["b"], "two.mp4", { type: "video/mp4" })];
  fireEvent.change(screen.getByLabelText("选择要批量上传的图片或视频"), { target: { files } });
  await waitFor(() => expect(mediaValue()).toHaveLength(2));
  expect(mediaValue().map(item => [item.url, item.type])).toEqual([["/uploads/one.jpg", "IMAGE"], ["/uploads/two.mp4", "VIDEO"]]);
  expect(upload).toHaveBeenNthCalledWith(1, "page-1", files[0], "image/jpeg"); expect(upload).toHaveBeenNthCalledWith(2, "page-1", files[1], "video/mp4");
  expect(global).not.toHaveBeenCalled(); expect(notify.mock.calls).toEqual([[true], [false]]);
});
it("does not attach a late upload or continue the batch after its original module disappears", async () => {
  let finish!: (result: { url: string; key: string }) => void;
  const upload = vi.spyOn(marketingApi, "uploadMedia").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ url: "/uploads/next.jpg", key: "next" });
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("选择要批量上传的图片或视频"), { target: { files: [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(upload).toHaveBeenCalledOnce()); fireEvent.click(screen.getByRole("button", { name: "Delete media block" }));
  await act(async () => finish({ url: "/uploads/late.jpg", key: "late" }));
  expect(documentValue().blocks.map(block => block.id)).toEqual(["buy"]); expect(upload).toHaveBeenCalledOnce();
});
