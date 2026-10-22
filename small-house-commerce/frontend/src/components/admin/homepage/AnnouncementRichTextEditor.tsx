"use client";

import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Highlight from "@tiptap/extension-highlight";
import Italic from "@tiptap/extension-italic";
import Paragraph from "@tiptap/extension-paragraph";
import Strike from "@tiptap/extension-strike";
import Text from "@tiptap/extension-text";
import TextAlign from "@tiptap/extension-text-align";
import {
  Color,
  FontFamily,
  FontSize,
  TextStyle,
} from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { UndoRedo } from "@tiptap/extensions/undo-redo";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import {
  ANNOUNCEMENT_EDITOR_FONT_FAMILY,
  ANNOUNCEMENT_EDITOR_FONT_SIZE,
  announcementEditorJson,
  announcementValueFromEditorJson,
  type AnnouncementEditorValue,
} from "@/lib/announcement-editor-document";
import type { AnnouncementRichTextDocument } from "@/lib/homepage-document";
import { useAdminI18n } from "@/lib/admin-i18n";

const COMMIT_DELAY_MS = 300;
const MAX_TEXT_LENGTH = 200;
const MAX_PARAGRAPHS = 2;

const AnnouncementLimits = Extension.create({
  name: "announcementLimits",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction(transaction) {
          if (!transaction.docChanged) return true;
          let paragraphs = 0;
          transaction.doc.descendants((node) => {
            if (node.type.name === "paragraph") paragraphs += 1;
          });
          return (
            paragraphs <= MAX_PARAGRAPHS &&
            transaction.doc.textBetween(0, transaction.doc.content.size, "\n")
              .length <= MAX_TEXT_LENGTH
          );
        },
      }),
    ];
  },
});

const EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  Bold,
  Italic,
  Underline,
  Strike,
  UndoRedo,
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({
    types: ["paragraph"],
    alignments: ["left", "center", "right"],
    defaultAlignment: "center",
  }),
  AnnouncementLimits,
];

function sanitizedPasteJson(text: string): JSONContent {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const first = lines[0].slice(0, MAX_TEXT_LENGTH);
  const remaining = Math.max(0, MAX_TEXT_LENGTH - first.length - 1);
  const second = lines.length > 1 ? lines.slice(1).join(" ").slice(0, remaining) : "";
  const paragraphs = second === "" ? [first] : [first, second];
  return {
    type: "doc",
    content: paragraphs.map((line) => ({
      type: "paragraph",
      attrs: { textAlign: "center" },
      ...(line === "" ? {} : { content: [{ type: "text", text: line }] }),
    })),
  };
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={`rounded border px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-cta bg-primary-light text-cta"
          : "border-border bg-card text-ink-secondary"
      }`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

const ALIGNMENT_KEYS = {
  left: "homepage_builder_align_left",
  center: "homepage_builder_align_center",
  right: "homepage_builder_align_right",
} as const;

/**
 * The copy the operator has highlighted. The editor's own selection is the
 * accurate source; the DOM selection is the fallback for the moment when the
 * editor state has not caught up with the drag yet.
 */
function selectedCopy(editor: Editor | null): string {
  if (editor) {
    const { from, to, empty } = editor.state.selection;
    if (!empty) {
      const text = editor.state.doc.textBetween(from, to, " ").trim();
      if (text !== "") return text;
    }
  }
  if (typeof window === "undefined") return "";
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? "";
  return text;
}

function EditorToolbar({
  editor,
  onUseSelectionAsLinkLabel,
}: {
  editor: Editor | null;
  onUseSelectionAsLinkLabel?: (text: string) => void;
}): ReactElement {
  const { t } = useAdminI18n();
  const canRun = editor !== null;
  const chain = (): ReturnType<Editor["chain"]> => editor!.chain().focus();

  return (
    <div
      role="toolbar"
      aria-label={t("homepage_builder_announcement_typography")}
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface p-2"
    >
      <select
        aria-label={t("homepage_builder_announcement_font_family")}
        className="rounded border border-border bg-card px-1.5 py-1 text-xs text-ink"
        defaultValue=""
        disabled={!canRun}
        onChange={(event) => {
          if (!editor) return;
          if (event.target.value === "") editor.chain().focus().unsetFontFamily().run();
          else editor.chain().focus().setFontFamily(event.target.value).run();
        }}
      >
        <option value="">
          {t("homepage_builder_announcement_default_font")}
        </option>
        <option value={ANNOUNCEMENT_EDITOR_FONT_FAMILY.SANS}>
          {t("homepage_builder_announcement_font_storefront")}
        </option>
        <option value={ANNOUNCEMENT_EDITOR_FONT_FAMILY.POPPINS}>
          {t("homepage_builder_announcement_font_poppins")}
        </option>
      </select>
      <select
        aria-label={t("homepage_builder_field_font_size")}
        className="rounded border border-border bg-card px-1.5 py-1 text-xs text-ink"
        defaultValue=""
        disabled={!canRun}
        onChange={(event) => {
          if (!editor) return;
          if (event.target.value === "") editor.chain().focus().unsetFontSize().run();
          else editor.chain().focus().setFontSize(event.target.value).run();
        }}
      >
        <option value="">
          {t("homepage_builder_announcement_default_size")}
        </option>
        <option value={ANNOUNCEMENT_EDITOR_FONT_SIZE.XS}>11px</option>
        <option value={ANNOUNCEMENT_EDITOR_FONT_SIZE.SM}>12px</option>
        <option value={ANNOUNCEMENT_EDITOR_FONT_SIZE.MD}>14px</option>
        <option value={ANNOUNCEMENT_EDITOR_FONT_SIZE.LG}>16px</option>
      </select>
      <ToolbarButton
        label={t("homepage_builder_announcement_bold")}
        active={editor?.isActive("bold") ?? false}
        disabled={!canRun}
        onClick={() => chain().toggleBold().run()}
      />
      <ToolbarButton
        label={t("homepage_builder_announcement_italic")}
        active={editor?.isActive("italic") ?? false}
        disabled={!canRun}
        onClick={() => chain().toggleItalic().run()}
      />
      <ToolbarButton
        label={t("homepage_builder_announcement_underline")}
        active={editor?.isActive("underline") ?? false}
        disabled={!canRun}
        onClick={() => chain().toggleUnderline().run()}
      />
      <ToolbarButton
        label={t("homepage_builder_announcement_strike")}
        active={editor?.isActive("strike") ?? false}
        disabled={!canRun}
        onClick={() => chain().toggleStrike().run()}
      />
      <label className="flex items-center gap-1 text-xs text-ink-secondary">
        {t("homepage_builder_field_text_color")}
        <input
          type="color"
          aria-label={t("homepage_builder_field_text_color")}
          className="h-7 w-8 rounded border border-border bg-card p-0.5"
          defaultValue="#292724"
          disabled={!canRun}
          onChange={(event) => chain().setColor(event.target.value).run()}
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-secondary">
        {t("homepage_builder_announcement_highlight_color")}
        <input
          type="color"
          aria-label={t("homepage_builder_announcement_highlight_color")}
          className="h-7 w-8 rounded border border-border bg-card p-0.5"
          defaultValue="#FFF2AA"
          disabled={!canRun}
          onChange={(event) =>
            chain().setHighlight({ color: event.target.value }).run()
          }
        />
      </label>
      {(["left", "center", "right"] as const).map((alignment) => (
        <ToolbarButton
          key={alignment}
          label={t(ALIGNMENT_KEYS[alignment])}
          active={editor?.isActive({ textAlign: alignment }) ?? false}
          disabled={!canRun}
          onClick={() => chain().setTextAlign(alignment).run()}
        />
      ))}
      <ToolbarButton
        label={t("homepage_builder_announcement_undo")}
        disabled={!editor?.can().undo()}
        onClick={() => chain().undo().run()}
      />
      <ToolbarButton
        label={t("homepage_builder_announcement_redo")}
        disabled={!editor?.can().redo()}
        onClick={() => chain().redo().run()}
      />
      <ToolbarButton
        label={t("homepage_builder_announcement_clear_formatting")}
        disabled={!canRun}
        onClick={() => chain().unsetAllMarks().setTextAlign("center").run()}
      />
      {onUseSelectionAsLinkLabel ? (
        <ToolbarButton
          label={t("homepage_builder_announcement_use_selection_as_link")}
          disabled={!canRun}
          onClick={() => {
            // The button keeps the focus (mousedown is prevented), so the
            // selection the operator just made is still there.
            const text = selectedCopy(editor);
            if (text === "") return;
            onUseSelectionAsLinkLabel(text);
          }}
        />
      ) : null}
    </div>
  );
}

export function AnnouncementRichTextEditor({
  itemId,
  content,
  fallbackText,
  onChange,
  onUseSelectionAsLinkLabel,
}: {
  itemId: string;
  content?: AnnouncementRichTextDocument;
  fallbackText: string;
  onChange(value: AnnouncementEditorValue): void;
  /**
   * Called with the copy the operator highlighted, so a phrase from the
   * announcement can become the link label without retyping it.
   */
  onUseSelectionAsLinkLabel?: (text: string) => void;
}): ReactElement {
  const { t } = useAdminI18n();
  const initialContent = useMemo(
    () => announcementEditorJson(content, fallbackText),
    [content, fallbackText],
  );
  const onChangeRef = useRef(onChange);
  const editorRef = useRef<Editor | null>(null);
  const pendingRef = useRef<
    { value: AnnouncementEditorValue; fire: typeof onChange } | undefined
  >(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const flush = useCallback((): void => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    const pending = pendingRef.current;
    pendingRef.current = undefined;
    if (pending) pending.fire(pending.value);
  }, []);

  const schedule = useCallback((value: AnnouncementEditorValue): void => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    pendingRef.current = { value, fire: onChangeRef.current };
    timerRef.current = setTimeout(flush, COMMIT_DELAY_MS);
  }, [flush]);

  const editor = useEditor(
    {
      extensions: EXTENSIONS,
      content: initialContent,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": t("homepage_builder_announcement_editor_label"),
          class:
            "min-h-20 rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink outline-none focus:border-cta",
        },
        handlePaste(_view, event) {
          const plain = event.clipboardData?.getData("text/plain");
          if (plain === undefined) return false;
          event.preventDefault();
          const current = editorRef.current;
          if (!current) return true;
          const json = sanitizedPasteJson(plain);
          const parsed = ProseMirrorDOMParser.fromSchema(current.schema);
          const container = document.createElement("div");
          for (const paragraph of json.content ?? []) {
            const element = document.createElement("p");
            element.textContent = paragraph.content?.[0]?.text ?? "";
            container.append(element);
          }
          const slice = parsed.parseSlice(container, { preserveWhitespace: true });
          current.view.dispatch(current.state.tr.replaceSelection(slice).scrollIntoView());
          return true;
        },
      },
      onUpdate({ editor: updatedEditor }) {
        const next = announcementValueFromEditorJson(updatedEditor.getJSON());
        if (next) schedule(next);
      },
      onBlur() {
        flush();
      },
    },
    [itemId],
  );

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || pendingRef.current) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(initialContent)) {
      editor.commands.setContent(initialContent, { emitUpdate: false });
    }
  }, [editor, initialContent]);

  useEffect(() => flush, [flush]);

  const stopEditorShortcut = (event: KeyboardEvent<HTMLDivElement>): void => {
    const save = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
    if (!save) event.stopPropagation();
  };

  return (
    <div
      data-announcement-rich-editor={itemId}
      className="flex flex-col gap-2"
      onKeyDown={stopEditorShortcut}
    >
      <EditorToolbar
        editor={editor}
        onUseSelectionAsLinkLabel={onUseSelectionAsLinkLabel}
      />
      <EditorContent editor={editor} onBlur={flush} />
    </div>
  );
}
