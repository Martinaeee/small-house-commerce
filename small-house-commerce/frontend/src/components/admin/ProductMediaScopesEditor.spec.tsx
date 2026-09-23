import { describe, expect, it } from "vitest";
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
    <GraphDraftHarness
      initial={initial}
      render={(draft, onChange) => (
        <ProductMediaScopesEditor draft={draft} onChange={onChange} />
      )}
    />
  );
}

describe("ProductMediaScopesEditor", () => {
  it("lists shared media read-only and points at the gallery tab", () => {
    render(<Harness initial={draft()} />);

    expect(screen.getByText(/共享媒体/)).toBeInTheDocument();
    expect(screen.getByText(/上方图库/)).toBeInTheDocument();
    // No uploader for shared rows: they are edited in the gallery tab only.
    expect(screen.queryByRole("button", { name: "上传图片" })).not.toBeInTheDocument();
  });

  it("asks for a media-driver group before offering value scopes", () => {
    render(
      <Harness
        initial={draft({ options: [optionDraft({ isMediaDriver: false })] })}
      />,
    );

    expect(screen.getByText(/媒体驱动/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add media for Red/ })).not.toBeInTheDocument();
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
    await user.click(within(redSection).getAllByRole("button", { name: "Remove" })[0]);

    const media = (draftJson() as AdminCatalogGraphDraft).media;
    expect(media.map((row) => row.id)).toEqual(["m1", "m3"]);
    const scoped = media.filter((row) => row.optionValueRef !== null);
    expect(scoped.map((row) => row.sortOrder)).toEqual([0]);
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
});
