import { describe, expect, it } from "vitest";

import {
  announcementRichTextPlainText,
  parseAnnouncementRichText,
} from "./announcement-rich-text";

const canonical = {
  version: 1,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { textAlign: "center" },
        content: [
          {
            type: "text",
            text: "Rich ",
            marks: [{ type: "bold" }],
          },
          {
            type: "text",
            text: "message",
            marks: [
              {
                type: "textStyle",
                attrs: {
                  color: "#123ABC",
                  fontFamily: "POPPINS",
                  fontSize: "LG",
                },
              },
              { type: "highlight", attrs: { color: "#FFF2AA" } },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { textAlign: "right" },
        content: [
          {
            type: "text",
            text: "Today only",
            marks: [{ type: "italic" }, { type: "underline" }],
          },
        ],
      },
    ],
  },
} as const;

describe("announcement rich-text normalization", () => {
  it("accepts canonical content and projects its normalized fallback text", () => {
    const parsed = parseAnnouncementRichText(canonical);

    expect(parsed).toEqual(canonical);
    expect(announcementRichTextPlainText(parsed!)).toBe(
      "Rich message\nToday only",
    );
  });

  it.each([
    {
      label: "unknown node",
      mutate: (value: Record<string, unknown>) => {
        const doc = value.doc as { content: Array<Record<string, unknown>> };
        doc.content[0] = { type: "heading", attrs: {}, content: [] };
      },
    },
    {
      label: "duplicate mark",
      mutate: (value: Record<string, unknown>) => {
        const doc = value.doc as {
          content: Array<{ content: Array<Record<string, unknown>> }>;
        };
        doc.content[0].content[0].marks = [
          { type: "bold" },
          { type: "bold" },
        ];
      },
    },
    {
      label: "unsafe style",
      mutate: (value: Record<string, unknown>) => {
        const doc = value.doc as {
          content: Array<{ content: Array<Record<string, unknown>> }>;
        };
        doc.content[0].content[0].marks = [
          {
            type: "textStyle",
            attrs: { fontFamily: "Comic Sans", style: "position:fixed" },
          },
        ];
      },
    },
    {
      label: "third paragraph",
      mutate: (value: Record<string, unknown>) => {
        const doc = value.doc as { content: Array<Record<string, unknown>> };
        doc.content.push(structuredClone(doc.content[0]));
      },
    },
  ])("rejects $label rather than rendering untrusted content", ({ mutate }) => {
    const value = structuredClone(canonical) as unknown as Record<
      string,
      unknown
    >;
    mutate(value);

    expect(parseAnnouncementRichText(value)).toBeNull();
  });

  it("rejects content whose normalized plain text exceeds 200 characters", () => {
    const value = structuredClone(canonical) as unknown as {
      doc: { content: Array<{ content: Array<{ text: string }> }> };
    };
    value.doc.content[0].content[0].text = "x".repeat(201);

    expect(parseAnnouncementRichText(value)).toBeNull();
  });
});
