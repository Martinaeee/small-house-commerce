import type {
  AnnouncementParagraphNode,
  AnnouncementRichTextDocument,
  AnnouncementTextMark,
  AnnouncementTextNode,
  AnnouncementTextStyleAttrs,
} from "./homepage-document";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const TEXT_ALIGNMENTS = new Set(["left", "center", "right"]);
const FONT_FAMILIES = new Set(["SANS", "POPPINS"]);
const FONT_SIZES = new Set(["XS", "SM", "MD", "LG"]);
const SIMPLE_MARKS = new Set(["bold", "italic", "underline", "strike"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key));
}

function parseTextStyleAttrs(value: unknown): AnnouncementTextStyleAttrs | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["color", "fontFamily", "fontSize"])) {
    return null;
  }
  if (Object.keys(value).length === 0) return null;
  if (value.color !== undefined && (typeof value.color !== "string" || !HEX_COLOR.test(value.color))) {
    return null;
  }
  if (
    value.fontFamily !== undefined &&
    (typeof value.fontFamily !== "string" || !FONT_FAMILIES.has(value.fontFamily))
  ) {
    return null;
  }
  if (
    value.fontSize !== undefined &&
    (typeof value.fontSize !== "string" || !FONT_SIZES.has(value.fontSize))
  ) {
    return null;
  }

  const attrs: AnnouncementTextStyleAttrs = {};
  if (typeof value.color === "string") attrs.color = value.color;
  if (value.fontFamily === "SANS" || value.fontFamily === "POPPINS") {
    attrs.fontFamily = value.fontFamily;
  }
  if (
    value.fontSize === "XS" ||
    value.fontSize === "SM" ||
    value.fontSize === "MD" ||
    value.fontSize === "LG"
  ) {
    attrs.fontSize = value.fontSize;
  }
  return attrs;
}

function parseMark(value: unknown): AnnouncementTextMark | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (SIMPLE_MARKS.has(value.type)) {
    if (!hasOnlyKeys(value, ["type"])) return null;
    return { type: value.type as "bold" | "italic" | "underline" | "strike" };
  }
  if (value.type === "textStyle") {
    if (!hasOnlyKeys(value, ["type", "attrs"])) return null;
    const attrs = parseTextStyleAttrs(value.attrs);
    return attrs === null ? null : { type: "textStyle", attrs };
  }
  if (value.type === "highlight") {
    if (!hasOnlyKeys(value, ["type", "attrs"]) || !isRecord(value.attrs)) {
      return null;
    }
    if (
      !hasOnlyKeys(value.attrs, ["color"]) ||
      typeof value.attrs.color !== "string" ||
      !HEX_COLOR.test(value.attrs.color)
    ) {
      return null;
    }
    return { type: "highlight", attrs: { color: value.attrs.color } };
  }
  return null;
}

function parseTextNode(value: unknown): AnnouncementTextNode | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "text", "marks"]) ||
    value.type !== "text" ||
    typeof value.text !== "string" ||
    value.text.length === 0 ||
    value.text.length > 200
  ) {
    return null;
  }

  if (value.marks === undefined) return { type: "text", text: value.text };
  if (!Array.isArray(value.marks) || value.marks.length > 6) return null;
  const marks: AnnouncementTextMark[] = [];
  const markTypes = new Set<string>();
  for (const candidate of value.marks) {
    const mark = parseMark(candidate);
    if (mark === null || markTypes.has(mark.type)) return null;
    marks.push(mark);
    markTypes.add(mark.type);
  }
  return { type: "text", text: value.text, marks };
}

function parseParagraph(value: unknown): AnnouncementParagraphNode | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "attrs", "content"]) ||
    value.type !== "paragraph" ||
    !isRecord(value.attrs) ||
    !hasOnlyKeys(value.attrs, ["textAlign"]) ||
    typeof value.attrs.textAlign !== "string" ||
    !TEXT_ALIGNMENTS.has(value.attrs.textAlign) ||
    !Array.isArray(value.content) ||
    value.content.length === 0
  ) {
    return null;
  }

  const content: AnnouncementTextNode[] = [];
  for (const candidate of value.content) {
    const node = parseTextNode(candidate);
    if (node === null) return null;
    content.push(node);
  }
  return {
    type: "paragraph",
    attrs: {
      textAlign: value.attrs.textAlign as "left" | "center" | "right",
    },
    content,
  };
}

export function announcementRichTextPlainText(
  value: AnnouncementRichTextDocument,
): string {
  return value.doc.content
    .map((paragraph) => paragraph.content.map((node) => node.text).join(""))
    .join("\n")
    .trim();
}

export function parseAnnouncementRichText(
  value: unknown,
): AnnouncementRichTextDocument | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["version", "doc"]) ||
    value.version !== 1 ||
    !isRecord(value.doc) ||
    !hasOnlyKeys(value.doc, ["type", "content"]) ||
    value.doc.type !== "doc" ||
    !Array.isArray(value.doc.content) ||
    value.doc.content.length < 1 ||
    value.doc.content.length > 2
  ) {
    return null;
  }

  const content: AnnouncementParagraphNode[] = [];
  for (const candidate of value.doc.content) {
    const paragraph = parseParagraph(candidate);
    if (paragraph === null) return null;
    content.push(paragraph);
  }
  const parsed: AnnouncementRichTextDocument = {
    version: 1,
    doc: { type: "doc", content },
  };
  return announcementRichTextPlainText(parsed).length <= 200 ? parsed : null;
}
