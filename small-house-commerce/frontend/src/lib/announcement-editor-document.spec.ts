import { describe, expect, it } from "vitest";

import {
  announcementEditorJson,
  announcementValueFromEditorJson,
} from "./announcement-editor-document";

const canonical = {
  version: 1 as const,
  doc: {
    type: "doc" as const,
    content: [
      {
        type: "paragraph" as const,
        attrs: { textAlign: "right" as const },
        content: [
          {
            type: "text" as const,
            text: "Styled",
            marks: [
              { type: "bold" as const },
              {
                type: "textStyle" as const,
                attrs: {
                  color: "#123ABC",
                  fontFamily: "POPPINS" as const,
                  fontSize: "LG" as const,
                },
              },
              {
                type: "highlight" as const,
                attrs: { color: "#FFF2AA" },
              },
            ],
          },
        ],
      },
    ],
  },
};

describe("announcement editor document conversion", () => {
  it("initializes legacy text as plain editor JSON without interpreting markup", () => {
    expect(
      announcementEditorJson(undefined, "Save <script>alert(1)</script> now"),
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [
            { type: "text", text: "Save <script>alert(1)</script> now" },
          ],
        },
      ],
    });
  });

  it("round-trips supported typography through controlled editor CSS values", () => {
    const editorJson = announcementEditorJson(canonical, "ignored");
    expect(editorJson).toMatchObject({
      content: [
        {
          attrs: { textAlign: "right" },
          content: [
            {
              marks: expect.arrayContaining([
                {
                  type: "textStyle",
                  attrs: {
                    color: "#123ABC",
                    fontFamily: "var(--font-poppins)",
                    fontSize: "16px",
                  },
                },
              ]),
            },
          ],
        },
      ],
    });

    expect(announcementValueFromEditorJson(editorJson)).toEqual({
      content: canonical,
      text: "Styled",
    });
  });

  it("drops unsupported marks and style attributes before creating canonical JSON", () => {
    const value = announcementValueFromEditorJson({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center", onclick: "alert(1)" },
          content: [
            {
              type: "text",
              text: "Safe",
              marks: [
                { type: "link", attrs: { href: "javascript:alert(1)" } },
                {
                  type: "textStyle",
                  attrs: {
                    color: "red;position:fixed",
                    fontFamily: "Comic Sans",
                    fontSize: "999px",
                  },
                },
                { type: "bold" },
              ],
            },
          ],
        },
      ],
    });

    expect(value).toEqual({
      content: {
        version: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { textAlign: "center" },
              content: [
                { type: "text", text: "Safe", marks: [{ type: "bold" }] },
              ],
            },
          ],
        },
      },
      text: "Safe",
    });
  });

  it("returns an empty legacy value instead of an invalid empty rich document", () => {
    expect(
      announcementValueFromEditorJson({
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
    ).toEqual({ content: null, text: "" });
  });

  it("rejects editor output beyond two paragraphs or 200 plain-text characters", () => {
    expect(
      announcementValueFromEditorJson({
        type: "doc",
        content: Array.from({ length: 3 }, () => ({
          type: "paragraph",
          content: [{ type: "text", text: "line" }],
        })),
      }),
    ).toBeNull();
    expect(
      announcementValueFromEditorJson({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "x".repeat(201) }] },
        ],
      }),
    ).toBeNull();
  });
});
