"use client";

import { useState, type ReactNode } from "react";
import { Textarea } from "@/components/admin/Field";
import type { AdminFaqAnswerBlock } from "@/lib/admin-api";

export function answerToText(answer: AdminFaqAnswerBlock[]): string {
  return answer
    .map((block) =>
      block.kind === "paragraph"
        ? block.text
        : block.items.map((item) => `- ${item}`).join("\n"),
    )
    .join("\n\n");
}

export function textToAnswer(raw: string): AdminFaqAnswerBlock[] {
  const blocks: AdminFaqAnswerBlock[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push({ kind: "bullets", items: [...bullets] });
    bullets = [];
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushBullets();
      flushParagraph();
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (bullet[1].trim()) bullets.push(bullet[1].trim());
      continue;
    }
    flushBullets();
    paragraph.push(trimmed);
  }

  flushBullets();
  flushParagraph();
  return blocks;
}

/**
 * The answer editor keeps the operator's raw keystrokes in local state and
 * emits structured blocks alongside them. Parsing per keystroke and
 * re-serialising would swallow the spaces and blank lines mid-typing, so the
 * textarea value stays exactly what was typed until an external answer
 * actually changes.
 */
export function FaqAnswerInput({
  id,
  answer,
  onChange,
  readOnly = false,
}: {
  id: string;
  answer: AdminFaqAnswerBlock[];
  onChange: (answer: AdminFaqAnswerBlock[]) => void;
  readOnly?: boolean;
}): ReactNode {
  const [draft, setDraft] = useState(() => answerToText(answer));
  const loadedText = answerToText(answer);

  const [lastLoadedText, setLastLoadedText] = useState(loadedText);

  if (loadedText !== lastLoadedText) {
    setLastLoadedText(loadedText);
    // Parsing trims whitespace, so preserve the raw keystrokes until an external answer changes.
    if (answerToText(textToAnswer(draft)) !== loadedText) setDraft(loadedText);
  }

  return (
    <Textarea
      id={id}
      rows={5}
      value={draft}
      readOnly={readOnly}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(textToAnswer(event.target.value));
      }}
    />
  );
}
