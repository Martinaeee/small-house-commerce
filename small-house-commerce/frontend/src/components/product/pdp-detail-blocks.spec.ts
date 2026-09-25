import { describe, expect, it } from "vitest";
import {
  partitionDetailBlocks,
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
