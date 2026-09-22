import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ProductForm,
  emptyProductFormValue,
  type ProductFormValue,
} from "@/components/admin/ProductForm";
import type { AdminCatalogGraphDraft } from "@/lib/admin-product-graph";

/**
 * Task 11 — the 409-trap guard. A product whose catalogGraphVersion > 0 must
 * never be edited through the legacy whole-list variants/images form:
 *  - typed payloads (options on the wire) get the new options/matrix editors;
 *  - graph products WITHOUT a typed payload get an explicit lock notice and
 *    the save path strips the legacy keys (backend would 409).
 */

function baseValue(overrides: Partial<ProductFormValue> = {}): ProductFormValue {
  return {
    ...emptyProductFormValue(),
    name: "Chair",
    slug: "chair",
    categoryId: "018f0000-0000-7000-8000-000000000000",
    variants: [],
    // emptyProductFormValue is the NEW-product default (typed editors on);
    // these overrides restore the legacy/locked derivations for each mode.
    graphTyped: false,
    graph: {
      catalogGraphVersion: 0,
      defaultDisplayVariantRef: null,
      options: [],
      variants: [],
      media: [],
    },
    ...overrides,
  };
}

const typedGraph: AdminCatalogGraphDraft = {
  catalogGraphVersion: 3,
  defaultDisplayVariantRef: null,
  options: [
    {
      id: "option-1",
      kind: "COLOR",
      name: "Color",
      position: 0,
      presentation: "TEXT",
      isMediaDriver: false,
      isActive: true,
      values: [
        {
          id: "value-1",
          label: "Red",
          position: 0,
          swatchHex: null,
          thumbnailUrl: null,
          thumbnailAlt: null,
          isActive: true,
        },
      ],
    },
  ],
  variants: [],
  media: [],
};

function renderForm(initial: ProductFormValue, onSubmit = vi.fn()): ReturnType<typeof render> {
  return render(
    <ProductForm
      initial={initial}
      categories={[]}
      onSubmit={onSubmit}
      submitLabel="Save changes"
      pending={false}
      error={null}
    />,
  );
}

async function openVariantsTab(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /Variants/ }));
}

describe("ProductForm variants tab modes", () => {
  it("shows the typed editors for graph payloads and hides Add variant", async () => {
    renderForm(baseValue({ graphTyped: true, graph: typedGraph }));
    await openVariantsTab();

    expect(
      screen.getByRole("button", { name: /Add option group/ }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Add variant" })).not.toBeInTheDocument();
    expect(screen.getByText(/候选款式/)).toBeInTheDocument();
  });

  it("locks variant, media, and shipping editing for graph products without a typed payload", async () => {
    const user = userEvent.setup();
    const locked: AdminCatalogGraphDraft = {
      ...typedGraph,
      catalogGraphVersion: 2,
      options: [],
    };
    renderForm(baseValue({ graphTyped: false, graph: locked }));
    await openVariantsTab();

    expect(screen.getByRole("alert")).toHaveTextContent(/类型化选项图/);
    expect(screen.queryByRole("button", { name: "Add variant" })).not.toBeInTheDocument();

    // Media tab: the gallery is locked too (images writes would 409).
    await user.click(screen.getByRole("tab", { name: "Media" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);

    // Shipping tab: sku fields are locked as well.
    await user.click(screen.getByRole("tab", { name: /Shipping/ }));
    expect(screen.getByText(/物流字段编辑已暂停/)).toBeInTheDocument();
  });

  it("keeps the legacy editor for version-0 products", async () => {
    renderForm(baseValue());
    await openVariantsTab();

    expect(screen.getByRole("button", { name: "Add variant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add option group/ })).not.toBeInTheDocument();
  });

  it("blocks submit with the graph validation errors before serializing", async () => {
    const user = userEvent.setup();
    const badGraph: AdminCatalogGraphDraft = {
      ...typedGraph,
      options: [
        {
          ...typedGraph.options[0],
          values: [
            {
              id: "value-1",
              label: "Red",
              position: 0,
              swatchHex: null,
              thumbnailUrl: null,
              thumbnailAlt: null,
              isActive: true,
            },
            {
              id: "value-2",
              label: "red",
              position: 1,
              swatchHex: null,
              thumbnailUrl: null,
              thumbnailAlt: null,
              isActive: true,
            },
          ],
        },
      ],
    };
    const onSubmit = vi.fn();
    renderForm(baseValue({ graphTyped: true, graph: badGraph }));
    await openVariantsTab();
    await user.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Duplicate active value label/i);
  });
});
