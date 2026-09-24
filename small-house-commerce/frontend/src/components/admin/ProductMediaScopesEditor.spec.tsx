import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GraphDraftHarness, draftJson } from "@/test/harness";
import type {
  AdminCatalogGraphDraft,
  AdminMediaDraft,
  AdminOptionDraft,
  AdminOptionValueDraft,
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

  it("offers no value scopes until an active gallery-switching option is selected", () => {
    render(
      <Harness
        initial={draft({ options: [optionDraft({ isMediaDriver: false })] })}
      />,
    );

    expect(screen.getByLabelText("Gallery switching option")).toHaveValue("");
    expect(screen.getByText(/Choose an active option to switch/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add media for Red/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/media driver/i)).not.toBeInTheDocument();
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

    await user.selectOptions(
      screen.getByLabelText("Target variant"),
      screen.getByRole("option", { name: /Blue \/ M/ }),
    );

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

    expect(screen.getByLabelText("Target variant")).toHaveDisplayValue("Blue / M");
    expect(screen.getByLabelText("Media URL for Blue / M 1")).toHaveValue(
      "/uploads/blue-m.jpg",
    );
    await user.click(screen.getByRole("button", { name: "Add variant media" }));
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

    const redSection = screen
      .getByText("Red")
      .closest("section") as HTMLElement;
    await user.click(within(redSection).getAllByRole("button", { name: "Remove media" })[0]);

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

    const selector = screen.getByLabelText("Gallery switching option");
    await user.selectOptions(selector, "option-2");

    const state = draftJson() as AdminCatalogGraphDraft;
    expect(state.options.map((option) => option.isMediaDriver)).toEqual([false, true]);
    expect(state.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "old-scope", optionValueRef: { id: "value-1" } }),
      ]),
    );
    expect(screen.getByText(/Inactive option-value scopes/)).toBeInTheDocument();
    expect(screen.getByText(/Source: Color \/ Red/)).toBeInTheDocument();
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

    const advanced = screen.getAllByText("Exact-variant media")[1]?.closest("details");
    expect(advanced).not.toHaveAttribute("open");
    await user.click(screen.getAllByText("Exact-variant media")[1]!);
    expect(screen.getByLabelText("Media URL for Red / M 1")).toHaveValue("/uploads/variant.jpg");
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

    await user.type(screen.getByLabelText("Alt text for Red 1"), "Red chair");
    const media = (draftJson() as AdminCatalogGraphDraft).media;
    expect(media[0].altText).toBe("Red chair");
  });

  it("uses localized media labels and wraps row actions for narrow layouts", () => {
    render(<Harness initial={draft()} />);

    expect(screen.getByText(/Shared product gallery/)).toBeInTheDocument();
    expect(screen.getByLabelText("Gallery switching option")).toBeInTheDocument();
    expect(screen.getAllByText("Exact-variant media").length).toBeGreaterThan(0);
    expect(screen.getByText("No option switching")).toBeInTheDocument();
  });
});
