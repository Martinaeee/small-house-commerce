import type { CSSProperties, ReactElement, ReactNode } from "react";

import {
  parseAnnouncementRichText,
} from "@/lib/announcement-rich-text";
import type {
  AnnouncementRichTextDocument,
  AnnouncementTextMark,
  AnnouncementTextNode,
} from "@/lib/homepage-document";

const FONT_SIZE: Record<"XS" | "SM" | "MD" | "LG", string> = {
  XS: "11px",
  SM: "12px",
  MD: "14px",
  LG: "16px",
};

function markedText(node: AnnouncementTextNode, key: string): ReactNode {
  const marks = node.marks ?? [];
  const textStyle = marks.find(({ type }) => type === "textStyle");
  const highlight = marks.find(({ type }) => type === "highlight");
  const style: CSSProperties = {};
  if (textStyle?.type === "textStyle") {
    if (textStyle.attrs.color) style.color = textStyle.attrs.color;
    if (textStyle.attrs.fontSize) {
      style.fontSize = FONT_SIZE[textStyle.attrs.fontSize];
    }
    if (textStyle.attrs.fontFamily === "SANS") {
      style.fontFamily = "var(--font-sans)";
    } else if (textStyle.attrs.fontFamily === "POPPINS") {
      style.fontFamily = "var(--font-poppins), var(--font-sans)";
      style.fontWeight = 700;
    }
  }
  if (highlight?.type === "highlight") {
    style.backgroundColor = highlight.attrs.color;
  }

  let child: ReactNode = (
    <span key={`${key}-style`} style={style}>
      {node.text}
    </span>
  );
  const semanticMarks = marks.filter(
    (mark): mark is Extract<
      AnnouncementTextMark,
      { type: "bold" | "italic" | "underline" | "strike" }
    > =>
      mark.type === "bold" ||
      mark.type === "italic" ||
      mark.type === "underline" ||
      mark.type === "strike",
  );
  for (const mark of [...semanticMarks].reverse()) {
    if (mark.type === "bold") child = <strong>{child}</strong>;
    if (mark.type === "italic") child = <em>{child}</em>;
    if (mark.type === "underline") child = <u>{child}</u>;
    if (mark.type === "strike") child = <s>{child}</s>;
  }
  return <span key={key}>{child}</span>;
}

export function AnnouncementRichText({
  content,
}: {
  content: unknown;
}): ReactElement | null {
  const parsed = parseAnnouncementRichText(content);
  if (parsed === null) return null;

  return (
    <span
      data-announcement-rich-text
      className="min-w-0 max-w-full overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
    >
      {parsed.doc.content.map((paragraph, paragraphIndex) => (
        <span
          key={paragraphIndex}
          data-announcement-paragraph
          className="block"
          style={{ textAlign: paragraph.attrs.textAlign }}
        >
          {paragraph.content.map((node, nodeIndex) =>
            markedText(node, `${paragraphIndex}-${nodeIndex}`),
          )}
        </span>
      ))}
    </span>
  );
}

export function isValidAnnouncementRichText(
  content: unknown,
): content is AnnouncementRichTextDocument {
  return parseAnnouncementRichText(content) !== null;
}
