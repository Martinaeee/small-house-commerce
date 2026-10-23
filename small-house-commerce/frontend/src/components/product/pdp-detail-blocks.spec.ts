import { describe, expect, it } from "vitest";
import {
  partitionDetailBlocks,
  resolveDetailBlocksForSelection,
  type DetailBlockLike,
} from "./pdp-detail-blocks";

function block(
  url: string,
  type: DetailBlockLike["type"] = "IMAGE",
  altText: string | null = null,
): DetailBlockLike {
  return { url, type, altText };
}

describe("partitionDetailBlocks", () => {
  const cases: Array<{
    name: string;
    input: DetailBlockLike[];
    expectedUrls: string[];
  }> = [
    { name: "empty input", input: [], expectedUrls: [] },
    {
      name: "all blank URLs",
      input: [block(""), block("  ", "VIDEO", "Blank video")],
      expectedUrls: [],
    },
    {
      name: "one valid block after blanks",
      input: [block(""), block(" /featured.jpg ", "IMAGE", "Featured")],
      expectedUrls: [" /featured.jpg "],
    },
    {
      name: "valid blocks with blank entries interleaved",
      input: [
        block("featured.jpg", "IMAGE", "Featured"),
        block(" ", "VIDEO", "Ignored"),
        block("remaining-1.jpg", "IMAGE", "Detail one"),
        block("", "IMAGE", null),
        block("remaining-2.mp4", "VIDEO", "Detail video"),
      ],
      expectedUrls: [
        "featured.jpg",
        "remaining-1.jpg",
        "remaining-2.mp4",
      ],
    },
  ];

  it.each(cases)("conserves every valid block exactly once for $name", ({
    input,
    expectedUrls,
  }) => {
    const snapshot = structuredClone(input);

    const partition = partitionDetailBlocks(input);

    expect(partition.valid.map(({ url }) => url)).toEqual(expectedUrls);
    expect(
      [partition.featured, ...partition.remaining].filter(Boolean),
    ).toEqual(partition.valid);
    expect(partition.valid).toEqual(
      input.filter((candidate) => candidate.url.trim() !== ""),
    );
    expect(input).toEqual(snapshot);
  });

  it("preserves URL, type, alt text, object identity, and API order", () => {
    const featured = block("featured.jpg", "IMAGE", "Feature alt");
    const video = block("detail.mp4", "VIDEO", "Video alt");
    const final = block("final.jpg", "IMAGE", null);

    const result = partitionDetailBlocks([featured, video, final]);

    expect(result.featured).toBe(featured);
    expect(result.remaining).toEqual([video, final]);
    expect(result.valid).toEqual([featured, video, final]);
  });
});

describe("resolveDetailBlocksForSelection", () => {
  const options = [
    { id: "color", position: 0, isMediaDriver: true },
    { id: "size", position: 1, isMediaDriver: false },
  ];
  const blocks: DetailBlockLike[] = [
    { url: "/shared.jpg", type: "IMAGE", optionValueId: null, variantId: null },
    { url: "/orange.jpg", type: "IMAGE", optionValueId: "orange", variantId: null },
    { url: "/tall.jpg", type: "IMAGE", optionValueId: null, variantId: "tall" },
  ];
  const urls = (result: DetailBlockLike[]): string[] => result.map((b) => b.url);

  it("shows shared blocks when nothing scoped matches", () => {
    expect(urls(resolveDetailBlocksForSelection(blocks, options, {}, null))).toEqual([
      "/shared.jpg",
    ]);
  });

  it("replaces shared blocks with the selected option value's blocks", () => {
    expect(
      urls(resolveDetailBlocksForSelection(blocks, options, { color: "orange" }, null)),
    ).toEqual(["/orange.jpg"]);
  });

  it("prefers an exact variant over an option value", () => {
    expect(
      urls(
        resolveDetailBlocksForSelection(blocks, options, { color: "orange" }, "tall"),
      ),
    ).toEqual(["/tall.jpg"]);
  });

  it("ignores option values of non media-driver options", () => {
    const sized: DetailBlockLike[] = [
      { url: "/queen.jpg", type: "IMAGE", optionValueId: "queen", variantId: null },
    ];
    expect(
      urls(resolveDetailBlocksForSelection(sized, options, { size: "queen" }, null)),
    ).toEqual([]);
  });

  it("treats blocks without scope fields as shared", () => {
    const legacy: DetailBlockLike[] = [{ url: "/legacy.jpg", type: "IMAGE" }];
    expect(urls(resolveDetailBlocksForSelection(legacy, options, {}, null))).toEqual([
      "/legacy.jpg",
    ]);
  });
});
