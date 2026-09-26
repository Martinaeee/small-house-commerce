import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GraphDraftHarness, draftJson } from "@/test/harness";
import type {
  AdminCatalogGraphDraft,
  AdminMediaDraft,
  AdminOptionDraft,
  AdminOptionValueDraft,
  AdminSkuDraft,
  AdminVariantDraft,
} from "@/lib/admin-product-graph";
import { ProductMediaScopesEditor } from "@/components/admin/ProductMediaScopesEditor";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";

/**
 * Task 11 — scoped media editing: shared rows stay read-only (the gallery tab
 * owns them), option-value scopes require an active media-driver group, and
 * variant scopes address draft rows by stable keys. Every row carries exactly
 * one scope (exactly-one-of contract).
 */

function valueDraft(
  overrides: Partial<AdminOptionValueDraft> = {},
): AdminOptionValueDraft {
  return {
    id: "value-1",
    label: "Red",
    position: 0,
    swatchHex: null,
    thumbnailUrl: null,
    thumbnailAlt: null,
    isActive: true,
    ...overrides,
  };
}

function optionDraft(
  overrides: Partial<AdminOptionDraft> = {},
): AdminOptionDraft {
  return {
    id: "option-1",
    kind: "COLOR",
    name: "Color",
    position: 0,
    presentation: "TEXT",
    isMediaDriver: false,
    isActive: true,
    values: [valueDraft()],
    ...overrides,
  };
}

function skuDraft(id: string): AdminSkuDraft {
  return {
    id,
    skuCode: id.toUpperCase(),
    status: "ACTIVE",
    supplierSku: null,
    supplierCost: null,
    costCurrency: null,
    landedCost: null,
    price: 100,
    compareAtPrice: null,
    productWeight: null,
    packageWidth: null,
    packageHeight: null,
    packageDepth: null,
    packageWeight: null,
    volumetricWeight: null,
    onHand: 1,
  };
}

function variantDraft(
  overrides: Partial<AdminVariantDraft> = {},
): AdminVariantDraft {
  return {
    id: "variant-1",
    name: "Red / M",
    position: 0,
    combinationKey: "k1",
    optionValueRefs: [{ id: "value-1" }],
    sku: null,
    ...overrides,
  };
}

function mediaDraft(
  overrides: Partial<AdminMediaDraft> = {},
): AdminMediaDraft {
  return {
    id: "media-1",
    url: "/uploads/shared.jpg",
    type: "IMAGE",
    altText: "Shared",
    sortOrder: 0,
    optionValueRef: null,
    variantRef: null,
    ...overrides,
  };
}

function draft(overrides: Partial<AdminCatalogGraphDraft> = {}): AdminCatalogGraphDraft {
  return {
    catalogGraphVersion: 1,
    defaultDisplayVariantRef: null,
    options: [optionDraft()],
    variants: [variantDraft()],
    media: [mediaDraft()],
    ...overrides,
  };
}

function Harness({ initial }: { initial: AdminCatalogGraphDraft }) {
  return (
    <AdminI18nProvider>
      <GraphDraftHarness
        initial={initial}
        render={(draft, onChange) => (
          <ProductMediaScopesEditor draft={draft} onChange={onChange} />
        )}
      />
    </AdminI18nProvider>
  );
}

beforeEach(() => {
  setAdminLang("en");
});

describe("ProductMediaScopesEditor", () => {
  it("lists shared media read-only and points at the gallery tab", () => {
    render(<Harness initial={draft()} />);

    expect(screen.getByText(/Shared product gallery/)).toBeInTheDocument();
    expect(screen.getByText(/edited in the Media tab/)).toBeInTheDocument();
    expect(screen.getByText(/replace it rather than merging/)).toBeInTheDocument();
    // No uploader for shared rows: they are edited in the gallery tab only.
    expect(screen.queryByRole("button", { name: "上传图片" })).not.toBeInTheDocument();
  });

  it("renders semantic driver cards and changes only the selected driver flag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const color = optionDraft({
      id: "option-color",
      name: "Color",
      isMediaDriver: true,
      values: [valueDraft({ id: "value-red" })],
    });
    const size = optionDraft({
      id: "option-size",
      name: "Size",
      kind: "SIZE",
      position: 1,
      values: [valueDraft({ id: "value-medium", label: "M" })],
    });
    const archived = optionDraft({
      id: "option-archived",
      name: "Archived material",
      kind: "MATERIAL",
      position: 2,
      isActive: false,
    });
    const initial = draft({
      options: [color, size, archived],
      variants: [
        variantDraft({
          id: "variant-red",
          optionValueRefs: [{ id: "value-red" }],
          sku: skuDraft("sku-red"),
        }),
        variantDraft({
          id: "variant-medium",
          name: "M",
          optionValueRefs: [{ id: "value-medium" }],
          sku: skuDraft("sku-medium"),
        }),
        variantDraft({
          id: "variant-no-sku",
          optionValueRefs: [
            { id: "value-red" },
            { id: "value-medium" },
          ],
          sku: null,
        }),
      ],
      media: [
        mediaDraft({ id: "shared" }),
        mediaDraft({
          id: "red-scope",
          optionValueRef: { id: "value-red" },
        }),
      ],
    });
    render(
      <AdminI18nProvider>
        <ProductMediaScopesEditor draft={initial} onChange={onChange} />
      </AdminI18nProvider>,
    );

    const driverGroup = screen.getByRole("group", { name: "Gallery source" });
    const choices = within(driverGroup).getAllByRole("button");
    expect(choices).toHaveLength(3);
    expect(
      within(driverGroup).getByRole("button", { name: "Shared only" }),
    ).toHaveTextContent("Affected SKUs: 2");
    expect(
      within(driverGroup).getByRole("button", { name: "Color" }),
    ).toHaveTextContent("Affected SKUs: 1");
    expect(
      within(driverGroup).getByRole("button", { name: "Size" }),
    ).toHaveTextContent("Affected SKUs: 1");
    expect(
      within(driverGroup).queryByRole("button", {
        name: "Archived material",
      }),
    ).toBeNull();
    expect(
      within(driverGroup).getByRole("button", { name: "Color" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      choices.filter((choice) => choice.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(1);

    await user.click(
      within(driverGroup).getByRole("button", { name: "Size" }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = structuredClone(initial);
    const mutate = onChange.mock.calls[0]?.[0] as (
      value: AdminCatalogGraphDraft,
    ) => void;
    mutate(next);

    const expectedOptions = structuredClone(initial.options);
    expectedOptions.forEach((option) => {
      option.isMediaDriver = option.id === "option-size";
    });
    expect(next.options).toEqual(expectedOptions);
    expect(next.media).toEqual(initial.media);
    expect(next.variants).toEqual(initial.variants);
  });

  it("explains that shared-only still leaves exact overrides in charge", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft({
          options: [
            optionDraft({ id: "option-color", name: "Color", isMediaDriver: false }),
          ],
        })}
      />,
    );

    // Shared only is the active driver: the note must not claim every variant
    // uses the shared gallery, because exact overrides still win.
    expect(
      screen.getByText(
        "No option-value switching. Variants without exact overrides use the shared gallery.",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Color" }));
    expect(
      screen.queryByText(
        "No option-value switching. Variants without exact overrides use the shared gallery.",
      ),
    ).toBeNull();
  });

  it("offers no value scopes until an active gallery-switching option is selected", () => {
    render(
      <Harness
        initial={draft({ options: [optionDraft({ isMediaDriver: false })] })}
      />,
    );

    expect(screen.getByRole("button", { name: "Shared only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Color" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText(/Choose an active option to switch/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add media for Red/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/media driver/i)).not.toBeInTheDocument();
  });

  it("summarizes active, blank, and legacy option-value scopes truthfully", async () => {
    const user = userEvent.setup();
    const color = optionDraft({
      id: "option-color",
      name: "Color",
      isMediaDriver: true,
      values: [
        valueDraft({ id: "value-red", label: "Red" }),
        valueDraft({ id: "value-green", label: "Green", position: 1 }),
        valueDraft({
          id: "value-gray",
          label: "Gray",
          position: 2,
          isActive: false,
        }),
      ],
    });
    const size = optionDraft({
      id: "option-size",
      name: "Size",
      kind: "SIZE",
      position: 1,
      values: [valueDraft({ id: "value-medium", label: "M" })],
    });
    render(
      <Harness
        initial={draft({
          options: [color, size],
          media: [
            mediaDraft({ id: "shared" }),
            mediaDraft({
              id: "red-image",
              url: "/uploads/red.jpg",
              altText: "Red chair",
              optionValueRef: { id: "value-red" },
            }),
            mediaDraft({
              id: "red-blank-video",
              url: " ",
              type: "VIDEO",
              altText: null,
              sortOrder: 1,
              optionValueRef: { id: "value-red" },
            }),
            mediaDraft({
              id: "green-blank",
              url: "",
              altText: null,
              optionValueRef: { id: "value-green" },
            }),
            mediaDraft({
              id: "gray-legacy",
              url: "/uploads/gray.jpg",
              optionValueRef: { id: "value-gray" },
            }),
            mediaDraft({
              id: "medium-legacy",
              url: "/uploads/medium.jpg",
              optionValueRef: { id: "value-medium" },
            }),
          ],
        })}
      />,
    );

    const redSummary = screen.getByLabelText("Color / Red media summary");
    expect(redSummary).toHaveTextContent("Active");
    expect(redSummary).toHaveTextContent("Rows 2");
    expect(redSummary).toHaveTextContent("Usable 1");
    expect(redSummary).toHaveTextContent("Images 1");
    expect(redSummary).toHaveTextContent("Videos 1");
    expect(redSummary).toHaveTextContent("Alt text 1/2");
    expect(redSummary).toHaveTextContent("Replaces the shared gallery");

    const greenSummary = screen.getByLabelText("Color / Green media summary");
    expect(greenSummary).toHaveTextContent("Active");
    expect(greenSummary).toHaveTextContent("Rows 1");
    expect(greenSummary).toHaveTextContent("Usable 0");
    expect(greenSummary).toHaveTextContent(
      "No usable media; variants without an exact override use the shared gallery",
    );

    const graySummary = screen.getByLabelText("Color / Gray media summary");
    expect(graySummary).toHaveTextContent("Inactive / legacy");
    expect(graySummary).toHaveTextContent("Usable 1");
    expect(screen.getByLabelText("Size / M media summary")).toHaveTextContent(
      "Inactive / legacy",
    );

    const greenDetails = greenSummary.closest("details") as HTMLDetailsElement;
    expect(greenDetails).not.toHaveAttribute("open");
    await user.click(greenSummary);
    expect(greenDetails).toHaveAttribute("open");
    expect(
      within(greenDetails).getByLabelText("Media URL for Green 1"),
    ).toHaveValue("");
    expect(
      within(greenDetails).getByRole("button", { name: "Remove media" }),
    ).toBeInTheDocument();

    const grayDetails = graySummary.closest("details") as HTMLDetailsElement;
    await user.click(graySummary);
    expect(
      within(grayDetails).getByRole("button", { name: "Remove scope" }),
    ).toBeInTheDocument();
  });

  it("adds a value-scoped media row through the existing uploader", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft({
          options: [optionDraft({ isMediaDriver: true })],
          media: [],
        })}
      />,
    );

    await user.click(screen.getByLabelText("Color / Red media summary"));
    await user.click(screen.getByRole("button", { name: "Add media for Red" }));
    await user.type(
      screen.getByLabelText("Media URL for Red 1"),
      "/uploads/red-1.jpg",
    );

    const media = (draftJson() as AdminCatalogGraphDraft).media;
    expect(media).toHaveLength(1);
    expect(media[0].url).toBe("/uploads/red-1.jpg");
    expect(media[0].optionValueRef).toEqual({ id: "value-1" });
    expect(media[0].variantRef).toBeNull();
    expect(media[0].clientKey).toBeTruthy();
  });

  it("adds a variant-scoped media row carrying exactly one scope", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft()} />);

    await user.click(screen.getByLabelText("Red / M media resolution"));
    await user.click(screen.getByRole("button", { name: "Add variant media" }));
    await user.type(
      screen.getByLabelText("Media URL for Red / M 1"),
      "/uploads/red-m.jpg",
    );

    const media = (draftJson() as AdminCatalogGraphDraft).media;
    const scoped = media.find((row) => row.variantRef !== null);
    expect(scoped?.url).toBe("/uploads/red-m.jpg");
    expect(scoped?.variantRef).toEqual({ id: "variant-1" });
    expect(scoped?.optionValueRef).toBeNull();
  });

  it("moves, removes, and renumbers exact-variant rows inside the expanded editor", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft({
          media: [
            mediaDraft({
              id: "exact-a",
              url: "/uploads/a.jpg",
              variantRef: { id: "variant-1" },
            }),
            mediaDraft({
              id: "exact-b",
              url: "/uploads/b.jpg",
              sortOrder: 1,
              variantRef: { id: "variant-1" },
            }),
          ],
        })}
      />,
    );

    await user.click(screen.getByLabelText("Red / M media resolution"));
    await user.click(
      screen.getByRole("button", { name: "Move Red / M media 1 down" }),
    );

    let media = (draftJson() as AdminCatalogGraphDraft).media;
    expect(media.find((row) => row.id === "exact-a")?.sortOrder).toBe(1);
    expect(media.find((row) => row.id === "exact-b")?.sortOrder).toBe(0);

    const firstRow = document.getElementById("pf-row-exact-b");
    expect(firstRow).not.toBeNull();
    await user.click(
      within(firstRow as HTMLElement).getByRole("button", {
        name: "Remove media",
      }),
    );

    media = (draftJson() as AdminCatalogGraphDraft).media;
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ id: "exact-a", sortOrder: 0 });
    expect(media[0].optionValueRef).toBeNull();
    expect(media[0].variantRef).toEqual({ id: "variant-1" });
  });

  it("keeps an exact-variant selection when option values and variants adopt server ids", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const initial = draft({
      options: [
        optionDraft({
          id: undefined,
          clientKey: "option-color",
          values: [
            valueDraft({
              id: undefined,
              clientKey: "value-red",
            }),
            valueDraft({
              id: undefined,
              clientKey: "value-blue",
              label: "Blue",
              position: 1,
            }),
          ],
        }),
      ],
      variants: [
        variantDraft({
          id: undefined,
          clientKey: "variant-red",
          combinationKey: "option-color=value-red",
          optionValueRefs: [{ clientKey: "value-red" }],
        }),
        variantDraft({
          id: undefined,
          clientKey: "variant-blue",
          name: "Blue / M",
          position: 1,
          combinationKey: "option-color=value-blue",
          optionValueRefs: [{ clientKey: "value-blue" }],
        }),
      ],
      media: [],
    });
    const view = render(
      <AdminI18nProvider>
        <ProductMediaScopesEditor draft={initial} onChange={onChange} />
      </AdminI18nProvider>,
    );

    const initialBlueSummary = screen.getByLabelText(
      "Blue / M media resolution",
    );
    await user.click(initialBlueSummary);
    expect(initialBlueSummary.closest("details")).toHaveAttribute("open");

    const adopted = draft({
      options: [
        optionDraft({
          id: "option-color-id",
          values: [
            valueDraft({ id: "value-red-id" }),
            valueDraft({ id: "value-blue-id", label: "Blue", position: 1 }),
          ],
        }),
      ],
      variants: [
        variantDraft({
          id: "variant-red-id",
          combinationKey: "option-color-id=value-red-id",
          optionValueRefs: [{ id: "value-red-id" }],
        }),
        variantDraft({
          id: "variant-blue-id",
          name: "Blue / M",
          position: 1,
          combinationKey: "option-color-id=value-blue-id",
          optionValueRefs: [{ id: "value-blue-id" }],
        }),
      ],
      media: [
        mediaDraft({
          id: "blue-media",
          url: "/uploads/blue-m.jpg",
          optionValueRef: null,
          variantRef: { id: "variant-blue-id" },
        }),
      ],
    });
    onChange.mockClear();
    view.rerender(
      <AdminI18nProvider>
        <ProductMediaScopesEditor draft={adopted} onChange={onChange} />
      </AdminI18nProvider>,
    );

    const adoptedBlueSummary = screen.getByLabelText(
      "Blue / M media resolution",
    );
    const adoptedBlueDetails = adoptedBlueSummary.closest(
      "details",
    ) as HTMLDetailsElement;
    expect(adoptedBlueDetails).toHaveAttribute("open");
    expect(
      within(adoptedBlueDetails).getByLabelText("Media URL for Blue / M 1"),
    ).toHaveValue("/uploads/blue-m.jpg");
    await user.click(
      within(adoptedBlueDetails).getByRole("button", {
        name: "Add variant media",
      }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = structuredClone(adopted);
    const mutate = onChange.mock.calls[0]?.[0] as (
      value: AdminCatalogGraphDraft,
    ) => void;
    mutate(next);
    expect(next.media.at(-1)?.variantRef).toEqual({ id: "variant-blue-id" });
  });

  it("removes a scoped row and renumbers the scope set", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft({
          options: [optionDraft({ isMediaDriver: true })],
          media: [
            mediaDraft({ id: "m1", url: "/uploads/a.jpg", altText: "A" }),
            mediaDraft({
              id: "m2",
              url: "/uploads/b.jpg",
              altText: "B",
              sortOrder: 1,
              optionValueRef: { id: "value-1" },
            }),
            mediaDraft({
              id: "m3",
              url: "/uploads/c.jpg",
              altText: "C",
              sortOrder: 2,
              optionValueRef: { id: "value-1" },
            }),
          ],
        })}
      />,
    );

    const redSummary = screen.getByLabelText("Color / Red media summary");
    await user.click(redSummary);
    const redSection = redSummary.closest("details") as HTMLElement;
    await user.click(
      within(redSection).getAllByRole("button", { name: "Remove media" })[0],
    );

    const media = (draftJson() as AdminCatalogGraphDraft).media;
    expect(media.map((row) => row.id)).toEqual(["m1", "m3"]);
    const scoped = media.filter((row) => row.optionValueRef !== null);
    expect(scoped.map((row) => row.sortOrder)).toEqual([0]);
  });

  it("switches the gallery option without deleting the former option-value scope", async () => {
    const user = userEvent.setup();
    const size = optionDraft({
      id: "option-2",
      name: "Size",
      kind: "SIZE",
      position: 1,
      values: [valueDraft({ id: "value-2", label: "M" })],
    });
    render(
      <Harness
        initial={draft({
          options: [optionDraft({ isMediaDriver: true }), size],
          media: [
            mediaDraft({
              id: "old-scope",
              url: "/uploads/old.jpg",
              optionValueRef: { id: "value-1" },
            }),
          ],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Size" }));

    const state = draftJson() as AdminCatalogGraphDraft;
    expect(state.options.map((option) => option.isMediaDriver)).toEqual([false, true]);
    expect(state.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "old-scope", optionValueRef: { id: "value-1" } }),
      ]),
    );
    expect(
      screen.getByLabelText("Color / Red media summary"),
    ).toHaveTextContent("Inactive / legacy");
  });

  it("does not render an empty src while a controlled shared row is still blank", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = render(
      <AdminI18nProvider>
        <ProductMediaScopesEditor
          draft={draft()}
          sharedMedia={[
            { url: "", type: "IMAGE", altText: null },
            { url: "/uploads/current.jpg", type: "IMAGE", altText: "Current" },
          ]}
          onChange={vi.fn()}
        />
      </AdminI18nProvider>,
    );
    const errors = consoleError.mock.calls.flat().join("\n");
    consoleError.mockRestore();

    expect(errors).not.toContain("empty string");
    expect(container.querySelector('img[src=""]')).toBeNull();
    expect(container.querySelector('video[src=""]')).toBeNull();
    expect(screen.getByText(/2 shared items/)).toBeInTheDocument();
  });

  it("uses the current controlled shared draft for resolver fallback summaries", () => {
    const initial = draft({
      options: [optionDraft({ isMediaDriver: false })],
      media: [mediaDraft({ id: "persisted-shared" })],
    });
    const before = structuredClone(initial);
    const currentShared = [
      {
        url: "/uploads/current-a.jpg",
        type: "IMAGE" as const,
        altText: "A",
      },
      {
        url: "/uploads/current-b.jpg",
        type: "IMAGE" as const,
        altText: "B",
      },
    ];
    render(
      <AdminI18nProvider>
        <ProductMediaScopesEditor
          draft={initial}
          sharedMedia={currentShared}
          onChange={vi.fn()}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getByLabelText("Red / M media resolution")).toHaveTextContent(
      "Uses shared gallery · 2 media",
    );
    expect(initial).toEqual(before);
  });

  it("mirrors exact, driver-value, and shared resolution in collapsed variant rows", async () => {
    const user = userEvent.setup();
    const driver = optionDraft({
      id: "option-color",
      name: "Finish",
      isMediaDriver: true,
      values: [
        valueDraft({ id: "value-first", label: "Same" }),
        valueDraft({ id: "value-second", label: "Same", position: 1 }),
      ],
    });
    const size = optionDraft({
      id: "option-size",
      name: "Size",
      kind: "SIZE",
      position: 1,
      values: [
        valueDraft({ id: "value-m", label: "M" }),
        valueDraft({ id: "value-l", label: "L", position: 1 }),
      ],
    });
    render(
      <Harness
        initial={draft({
          options: [driver, size],
          variants: [
            variantDraft({
              id: "variant-exact",
              name: "Exact / M",
              optionValueRefs: [
                { id: "value-first" },
                { id: "value-m" },
              ],
            }),
            variantDraft({
              id: "variant-first",
              name: "First duplicate",
              position: 1,
              optionValueRefs: [
                { id: "value-first" },
                { id: "value-l" },
              ],
            }),
            variantDraft({
              id: "variant-second",
              name: "Second duplicate",
              position: 2,
              optionValueRefs: [
                { id: "value-second" },
                { id: "value-m" },
              ],
            }),
          ],
          media: [
            mediaDraft({ id: "shared-1" }),
            mediaDraft({ id: "shared-2", url: "/uploads/shared-2.jpg" }),
            mediaDraft({
              id: "first-scope",
              url: "/uploads/first.jpg",
              optionValueRef: { id: "value-first" },
            }),
            mediaDraft({
              id: "exact-1",
              url: "/uploads/exact-1.jpg",
              variantRef: { id: "variant-exact" },
            }),
            mediaDraft({
              id: "exact-2",
              url: "/uploads/exact-2.jpg",
              sortOrder: 1,
              variantRef: { id: "variant-exact" },
            }),
          ],
        })}
      />,
    );

    const exactSummary = screen.getByLabelText("Exact / M media resolution");
    const firstSummary = screen.getByLabelText(
      "First duplicate media resolution",
    );
    const secondSummary = screen.getByLabelText(
      "Second duplicate media resolution",
    );
    expect(exactSummary).toHaveTextContent("Exact override · 2 media");
    expect(firstSummary).toHaveTextContent("Uses Same gallery · 1 media");
    expect(secondSummary).toHaveTextContent("Uses shared gallery · 2 media");
    expect(exactSummary.closest("details")).not.toHaveAttribute("open");
    expect(firstSummary.closest("details")).not.toHaveAttribute("open");
    expect(secondSummary.closest("details")).not.toHaveAttribute("open");

    await user.click(exactSummary);
    const exactDetails = exactSummary.closest("details") as HTMLDetailsElement;
    expect(exactDetails).toHaveAttribute("open");
    expect(
      within(exactDetails).getByLabelText("Media URL for Exact / M 1"),
    ).toHaveValue("/uploads/exact-1.jpg");
    expect(
      within(exactDetails).getByRole("button", {
        name: "Add variant media",
      }),
    ).toBeInTheDocument();
  });

  it("opens the exact-variant scope that owns a highlighted media row", () => {
    const initial = draft({
      media: [
        mediaDraft({
          id: "variant-media",
          url: "not-a-url",
          optionValueRef: null,
          variantRef: { id: "variant-1" },
        }),
      ],
    });
    render(
      <AdminI18nProvider>
        <ProductMediaScopesEditor
          draft={initial}
          onChange={vi.fn()}
          highlightKey="variant-media"
        />
      </AdminI18nProvider>,
    );

    const summary = screen.getByLabelText("Red / M media resolution");
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByLabelText("Media URL for Red / M 1")).toBeVisible();
  });

  it("keeps exact-variant media in a collapsed advanced section", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft({
          media: [
            mediaDraft({
              id: "variant-media",
              url: "/uploads/variant.jpg",
              optionValueRef: null,
              variantRef: { id: "variant-1" },
            }),
          ],
        })}
      />,
    );

    const summary = screen.getByLabelText("Red / M media resolution");
    const advanced = summary.closest("details") as HTMLDetailsElement;
    expect(advanced).not.toHaveAttribute("open");
    await user.click(summary);
    expect(advanced).toHaveAttribute("open");
    expect(
      within(advanced).getByLabelText("Media URL for Red / M 1"),
    ).toHaveValue("/uploads/variant.jpg");
  });

  it("edits alt text of a scoped row", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft({
          options: [optionDraft({ isMediaDriver: true })],
          media: [
            mediaDraft({
              id: "m2",
              url: "/uploads/b.jpg",
              altText: "",
              optionValueRef: { id: "value-1" },
            }),
          ],
        })}
      />,
    );

    await user.click(screen.getByLabelText("Color / Red media summary"));
    await user.type(screen.getByLabelText("Alt text for Red 1"), "Red chair");
    const media = (draftJson() as AdminCatalogGraphDraft).media;
    expect(media[0].altText).toBe("Red chair");
  });

  it("uses localized media labels and wraps row actions for narrow layouts", () => {
    render(<Harness initial={draft()} />);

    expect(screen.getByText(/Shared product gallery/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Gallery source" })).toBeInTheDocument();
    expect(screen.getByLabelText("Red / M media resolution")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shared only" })).toBeInTheDocument();
  });
});
