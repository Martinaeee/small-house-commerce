import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductForm, emptyProductFormValue } from "@/components/admin/ProductForm";
import type { AdminCatalogGraphDraft, AdminSkuDraft } from "@/lib/admin-product-graph";
import { adminApi } from "@/lib/admin-api";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";

const ids = {
  option: "018f0000-0000-7000-8000-000000000010",
  red: "018f0000-0000-7000-8000-000000000011",
  blue: "018f0000-0000-7000-8000-000000000012",
  redVariant: "018f0000-0000-7000-8000-000000000021",
  blueVariant: "018f0000-0000-7000-8000-000000000022",
};
function sku(id: string, code: string): AdminSkuDraft {
  return { id, skuCode: code, status: "ACTIVE", supplierSku: null, supplierCost: null, costCurrency: null, landedCost: null, price: 100, compareAtPrice: null, productWeight: null, packageWidth: null, packageHeight: null, packageDepth: null, packageWeight: null, volumetricWeight: null, onHand: 2 };
}
function initialValue() {
  const graph: AdminCatalogGraphDraft = {
    catalogGraphVersion: 1,
    defaultDisplayVariantRef: null,
    options: [{ id: ids.option, kind: "COLOR", name: "Color", presentation: "TEXT", position: 0, isActive: true, isMediaDriver: true,
      values: [ids.red, ids.blue].map((id, position) => ({ id, label: position === 0 ? "Red" : "Blue", position, isActive: true, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null })),
    }],
    variants: [
      { id: ids.redVariant, name: "Red", position: 0, combinationKey: "red", optionValueRefs: [{ id: ids.red }], sku: sku("018f0000-0000-7000-8000-000000000031", "CHAIR-RED") },
      { id: ids.blueVariant, name: "Blue", position: 1, combinationKey: "blue", optionValueRefs: [{ id: ids.blue }], sku: sku("018f0000-0000-7000-8000-000000000032", "CHAIR-BLUE") },
    ],
    media: [{ id: "018f0000-0000-7000-8000-000000000041", type: "IMAGE", url: "/uploads/red-existing.jpg", altText: "Red", sortOrder: 4, optionValueRef: { id: ids.red }, variantRef: null }],
  };
  return { ...emptyProductFormValue(), name: "Chair", slug: "chair", categoryId: "018f0000-0000-7000-8000-000000000000", graphTyped: true, graph,
    images: [{ type: "IMAGE" as const, url: "/uploads/shared-existing.jpg", altText: "Shared", sortOrder: "10" }],
    detailBlocks: [{ type: "IMAGE" as const, url: "/uploads/detail-existing.jpg", altText: "Assembly", sortOrder: "7" }],
  };
}
function deferred() {
  let resolve!: (value: { url: string; key: string }) => void;
  const promise = new Promise<{ url: string; key: string }>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function renderForm(override?: ReturnType<typeof initialValue>) {
  const initial = override ?? initialValue();
  const onSubmit = vi.fn();
  const view = render(<AdminI18nProvider><ProductForm initial={initial} categories={[]} pending={false} error={null} onSubmit={onSubmit} savedPreview={null} /></AdminI18nProvider>);
  return { ...view, initial, onSubmit };
}
async function scope(kind: "value" | "variant" | "detail", color = "Red") {
  if (kind === "detail") return screen.getByRole("heading", { name: "Detail content (images / videos)" }).closest("section")!;
  const summary = screen.getByLabelText(kind === "value" ? `Color / ${color} media summary` : `${color} media resolution`);
  const details = summary.closest("details")!;
  if (!details.open) await userEvent.click(summary);
  return details;
}

beforeEach(() => setAdminLang("en"));
afterEach(() => vi.restoreAllMocks());

describe("ProductForm bulk media destinations", () => {
  it("keeps the detail uploader working when only the shared gallery is locked", async () => {
    const upload = vi.spyOn(adminApi, "uploadImage").mockResolvedValueOnce({ url: "/uploads/detail-new.jpg", key: "detail-new" });
    const initial = initialValue();
    const { onSubmit } = renderForm({ ...initial, graphTyped: false });
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    const detail = screen.getByRole("heading", { name: "Detail content (images / videos)" }).closest("section")!;
    expect(within(detail).getByRole("button", { name: "Upload images / videos (multiple)" })).toBeEnabled();
    fireEvent.change(within(detail).getByLabelText("Choose media to upload"), { target: { files: [new File(["x"], "new.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(detail).getByRole("status")).toHaveTextContent("Added 1 items"));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSubmit.mock.calls[0][0].detailBlocks.at(-1).url).toBe("/uploads/detail-new.jpg");
  });

  it.each(["shared", "value", "variant", "detail"] as const)("holds save during a single-item %s replacement without appending a row", async (kind) => {
    const first = deferred();
    const upload = vi.spyOn(adminApi, "uploadImage").mockReturnValueOnce(first.promise);
    const initial = initialValue();
    if (kind === "variant") initial.graph.media.push({ id: "018f0000-0000-7000-8000-000000000042", type: "IMAGE", url: "/uploads/exact.jpg", altText: "Exact", sortOrder: 0, optionValueRef: null, variantRef: { id: ids.redVariant } });
    const { container, onSubmit } = renderForm(initial);
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    const destination = kind === "shared" ? screen.getByRole("heading", { name: "Shared product gallery" }).closest("section")! : await scope(kind);
    await userEvent.click(within(destination).getByRole("button", { name: kind === "shared" ? "Media 1 (cover)" : kind === "detail" ? "Edit Detail content (images / videos) media 1" : "Edit Red media 1" }));
    fireEvent.change(destination.querySelector('input[type="file"]:not([multiple])')!, { target: { files: [new File(["replacement"], "replacement.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(container.querySelector('button[type="submit"]')).toBeDisabled();
    await userEvent.click(screen.getByRole("tab", { name: "Basic Info" }));
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => first.resolve({ url: "/uploads/replacement.jpg", key: "replacement" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled());
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    const receipt = kind === "shared" ? screen.getByRole("heading", { name: "Shared product gallery" }).closest("section")! : await scope(kind);
    expect(within(receipt).getByRole("status")).toHaveTextContent("Updated 1 item");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const saved = onSubmit.mock.calls[0][0];
    expect(saved.images).toHaveLength(1);
    expect(saved.detailBlocks).toHaveLength(1);
    expect(saved.graph.media).toHaveLength(initial.graph.media.length);
    const row = kind === "shared" ? saved.images[0] : kind === "detail" ? saved.detailBlocks[0] : saved.graph.media.find((item: { id: string }) => item.id === (kind === "value" ? "018f0000-0000-7000-8000-000000000041" : "018f0000-0000-7000-8000-000000000042"));
    expect(row.url).toBe("/uploads/replacement.jpg");
  });

  it("keeps a removed target's failed filenames visible outside its former gallery", async () => {
    const first = deferred();
    const upload = vi.spyOn(adminApi, "uploadImage").mockReturnValueOnce(first.promise).mockResolvedValue({ url: "/uploads/b.jpg", key: "b" });
    const { initial, onSubmit, rerender } = renderForm();
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    fireEvent.change(within(await scope("value")).getByLabelText("Choose media to upload"), { target: { files: [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const next = { ...initial, graph: { ...initial.graph, options: initial.graph.options.map((option) => ({ ...option, values: option.values.filter((value) => value.id !== ids.red) })), variants: initial.graph.variants.filter((variant) => variant.id !== ids.redVariant), media: [] } };
    rerender(<AdminI18nProvider><ProductForm initial={next} categories={[]} pending={false} error={null} onSubmit={onSubmit} savedPreview={null} /></AdminI18nProvider>);
    await act(async () => first.resolve({ url: "/uploads/a.jpg", key: "a" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Upload target no longer exists");
    expect(screen.getByRole("alert")).toHaveTextContent("a.jpg");
    expect(screen.getByRole("alert")).toHaveTextContent("b.jpg");
    expect(upload).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSubmit.mock.calls[0][0].graph.media).toEqual([]);
  });

  it.each(["value", "variant", "detail"] as const)("holds save across tabs and appends only to the original %s target", async (kind) => {
    const first = deferred();
    const second = deferred();
    const upload = vi.spyOn(adminApi, "uploadImage").mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    const { container, initial, onSubmit } = renderForm();
    await user.click(screen.getByRole("tab", { name: "Media" }));
    const destination = await scope(kind);
    const input = within(destination).getByLabelText("Choose media to upload");
    expect(input).toHaveAttribute("multiple");
    fireEvent.change(input, { target: { files: [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.mp4", { type: "video/mp4" })] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(container.querySelector('button[type="submit"]')).toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
    if (kind !== "detail") await scope(kind, "Blue");
    await user.click(screen.getByRole("tab", { name: "Basic Info" }));
    await act(async () => first.resolve({ url: "/uploads/a.png", key: "a" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(container.querySelector('button[type="submit"]')).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Media" }));
    expect(within(await scope(kind)).getByRole("status")).toHaveTextContent("Uploading 2/2 · b.mp4");
    await act(async () => second.resolve({ url: "/uploads/b.mp4", key: "b" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled());
    const receipt = await scope(kind);
    expect(within(receipt).getByRole("status")).toHaveTextContent("Added 2 items");
    expect(within(receipt).queryByRole("list", { name: "Media upload queue" })).not.toBeInTheDocument();
    await user.click(within(receipt).getByRole("button", { name: "Dismiss upload receipt" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const saved = onSubmit.mock.calls[0][0];
    expect(saved.images).toEqual(initial.images);
    expect(saved.graph.options).toEqual(initial.graph.options);
    expect(saved.graph.variants).toEqual(initial.graph.variants);
    if (kind === "detail") {
      expect(saved.graph.media).toEqual(initial.graph.media);
      expect(saved.detailBlocks).toEqual([
        ...initial.detailBlocks,
        { url: "/uploads/a.png", type: "IMAGE", altText: "", sortOrder: "8" },
        { url: "/uploads/b.mp4", type: "VIDEO", altText: "", sortOrder: "9" },
      ]);
    } else {
      expect(saved.detailBlocks).toEqual(initial.detailBlocks);
      expect(saved.graph.media[0]).toEqual(initial.graph.media[0]);
      const appended = saved.graph.media.slice(1);
      expect(appended.map((row: { url: string; type: string; sortOrder: number }) => ({ url: row.url, type: row.type, sortOrder: row.sortOrder }))).toEqual([
        { url: "/uploads/a.png", type: "IMAGE", sortOrder: kind === "value" ? 5 : 0 },
        { url: "/uploads/b.mp4", type: "VIDEO", sortOrder: kind === "value" ? 6 : 1 },
      ]);
      expect(new Set(appended.map((row: { clientKey: string }) => row.clientKey)).size).toBe(2);
      for (const row of appended) {
        expect(row.optionValueRef).toEqual(kind === "value" ? { id: ids.red } : null);
        expect(row.variantRef).toEqual(kind === "variant" ? { id: ids.redVariant } : null);
        expect(row.altText).toBeNull();
      }
    }
  });
});
