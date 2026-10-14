import type { JSONContent } from "@tiptap/core";

import {
  announcementRichTextPlainText,
  parseAnnouncementRichText,
} from "./announcement-rich-text";
import type {
  AnnouncementParagraphNode,
  AnnouncementRichTextDocument,
  AnnouncementTextMark,
  AnnouncementTextNode,
  AnnouncementTextStyleAttrs,
} from "./homepage-document";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const EDITOR_FONT_FAMILY = {
  SANS: "var(--font-sans)",
  POPPINS: "var(--font-poppins)",
} as const;
const EDITOR_FONT_SIZE = {
  XS: "11px",
  SM: "12px",
  MD: "14px",
  LG: "16px",
} as const;

export const ANNOUNCEMENT_EDITOR_FONT_FAMILY = EDITOR_FONT_FAMILY;
export const ANNOUNCEMENT_EDITOR_FONT_SIZE = EDITOR_FONT_SIZE;

export type AnnouncementEditorValue = {
  content: AnnouncementRichTextDocument | null;
  text: string;
};

type EditorMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

function markToEditor(mark: AnnouncementTextMark): EditorMark {
  if (mark.type === "textStyle") {
    return {
      type: "textStyle",
      attrs: {
        ...(mark.attrs.color ? { color: mark.attrs.color } : {}),
        ...(mark.attrs.fontFamily
          ? { fontFamily: EDITOR_FONT_FAMILY[mark.attrs.fontFamily] }
          : {}),
        ...(mark.attrs.fontSize
          ? { fontSize: EDITOR_FONT_SIZE[mark.attrs.fontSize] }
          : {}),
      },
    };
  }
  if (mark.type === "highlight") {
    return { type: "highlight", attrs: { color: mark.attrs.color } };
  }
  return { type: mark.type };
}

function richTextToEditor(value: AnnouncementRichTextDocument): JSONContent {
  return {
    type: "doc",
    content: value.doc.content.map<JSONContent>((paragraph) => ({
      type: "paragraph",
      attrs: { textAlign: paragraph.attrs.textAlign },
      content: paragraph.content.map<JSONContent>((node) => ({
        type: "text",
        text: node.text,
        ...(node.marks ? { marks: node.marks.map(markToEditor) } : {}),
      })),
    })),
  };
}

function plainTextToEditor(text: string): JSONContent {
  const normalized = text.replace(/\r\n?/g, "\n").slice(0, 200);
  const lines = normalized.split("\n");
  const paragraphs = lines.length <= 2 ? lines : [lines[0], lines.slice(1).join(" ")];
  return {
    type: "doc",
    content: paragraphs.map((line) => ({
      type: "paragraph",
      attrs: { textAlign: "center" },
      ...(line === "" ? {} : { content: [{ type: "text", text: line }] }),
    })),
  };
}

export function announcementEditorJson(
  content: unknown,
  fallbackText: string,
): JSONContent {
  const parsed = parseAnnouncementRichText(content);
  return parsed === null
    ? plainTextToEditor(fallbackText)
    : richTextToEditor(parsed);
}

function textStyleAttrs(value: Record<string, unknown>): AnnouncementTextStyleAttrs {
  const attrs: AnnouncementTextStyleAttrs = {};
  if (typeof value.color === "string" && HEX_COLOR.test(value.color)) {
    attrs.color = value.color;
  }
  if (
    value.fontFamily === EDITOR_FONT_FAMILY.SANS ||
    value.fontFamily === "SANS"
  ) {
    attrs.fontFamily = "SANS";
  } else if (
    value.fontFamily === EDITOR_FONT_FAMILY.POPPINS ||
    value.fontFamily === "POPPINS"
  ) {
    attrs.fontFamily = "POPPINS";
  }
  for (const [token, editorValue] of Object.entries(EDITOR_FONT_SIZE)) {
    if (value.fontSize === editorValue || value.fontSize === token) {
      attrs.fontSize = token as keyof typeof EDITOR_FONT_SIZE;
      break;
    }
  }
  return attrs;
}

function marksFromEditor(value: unknown): AnnouncementTextMark[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const marks: AnnouncementTextMark[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const mark = candidate as { type?: unknown; attrs?: unknown };
    if (typeof mark.type !== "string" || seen.has(mark.type)) continue;
    if (
      mark.type === "bold" ||
      mark.type === "italic" ||
      mark.type === "underline" ||
      mark.type === "strike"
    ) {
      marks.push({ type: mark.type });
      seen.add(mark.type);
      continue;
    }
    if (mark.type === "textStyle" && mark.attrs && typeof mark.attrs === "object") {
      const attrs = textStyleAttrs(mark.attrs as Record<string, unknown>);
      if (Object.keys(attrs).length > 0) {
        marks.push({ type: "textStyle", attrs });
        seen.add(mark.type);
      }
      continue;
    }
    if (mark.type === "highlight" && mark.attrs && typeof mark.attrs === "object") {
      const color = (mark.attrs as Record<string, unknown>).color;
      if (typeof color === "string" && HEX_COLOR.test(color)) {
        marks.push({ type: "highlight", attrs: { color } });
        seen.add(mark.type);
      }
    }
  }
  return marks.length > 0 ? marks : undefined;
}

function paragraphFromEditor(value: JSONContent): AnnouncementParagraphNode | null {
  if (value.type !== "paragraph" || !Array.isArray(value.content)) return null;
  const textAlign = value.attrs?.textAlign;
  const alignment =
    textAlign === "left" || textAlign === "right" || textAlign === "center"
      ? textAlign
      : "center";
  const content: AnnouncementTextNode[] = [];
  for (const candidate of value.content) {
    if (
      candidate.type !== "text" ||
      typeof candidate.text !== "string" ||
      candidate.text.length === 0
    ) {
      continue;
    }
    const marks = marksFromEditor(candidate.marks);
    content.push({
      type: "text",
      text: candidate.text,
      ...(marks ? { marks } : {}),
    });
  }
  if (content.length === 0) return null;
  return { type: "paragraph", attrs: { textAlign: alignment }, content };
}

export function announcementValueFromEditorJson(
  value: JSONContent,
): AnnouncementEditorValue | null {
  if (value.type !== "doc" || !Array.isArray(value.content)) return null;
  if (value.content.length > 2) return null;
  const paragraphs = value.content
    .map(paragraphFromEditor)
    .filter((paragraph): paragraph is AnnouncementParagraphNode => paragraph !== null);
  if (paragraphs.length === 0) return { content: null, text: "" };

  const content: AnnouncementRichTextDocument = {
    version: 1,
    doc: { type: "doc", content: paragraphs },
  };
  const text = announcementRichTextPlainText(content);
  if (text.length > 200) return null;
  return { content, text };
}
