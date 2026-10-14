import type { ReactElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { AnnouncementRichTextEditor } from "./AnnouncementRichTextEditor";

const ITEM_ONE = "00000000-0000-7000-8000-000000000021";
const ITEM_TWO = "00000000-0000-7000-8000-000000000022";

async function editor(
  label: string = "Announcement rich text",
): Promise<HTMLElement> {
  return screen.findByRole("textbox", { name: label });
}

async function flushEditorCommit(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

function renderWithI18n(ui: ReactElement) {
  return render(ui, { wrapper: AdminI18nProvider });
}

beforeEach(() => {
  setAdminLang("en");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AnnouncementRichTextEditor", () => {
  it("initializes legacy text without interpreting it as HTML", async () => {
    renderWithI18n(
      <AnnouncementRichTextEditor
        itemId={ITEM_ONE}
        fallbackText={'Save <script>alert("x")</script> now'}
        onChange={vi.fn()}
      />,
    );

    const textbox = await editor();
    expect(textbox).toHaveTextContent('Save <script>alert("x")</script> now');
    expect(textbox.querySelector("script")).toBeNull();
  });

  it("exposes only the approved typography controls", async () => {
    renderWithI18n(
      <AnnouncementRichTextEditor
        itemId={ITEM_ONE}
        fallbackText="Offer"
        onChange={vi.fn()}
      />,
    );
    await editor();

    for (const name of [
      "Bold",
      "Italic",
      "Underline",
      "Strike",
      "Align left",
      "Align center",
      "Align right",
      "Undo",
      "Redo",
      "Clear formatting",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("combobox", { name: "Font family" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Font size" })).toBeInTheDocument();
    expect(screen.getByLabelText("Text color")).toHaveAttribute("type", "color");
    expect(screen.getByLabelText("Highlight color")).toHaveAttribute(
      "type",
      "color",
    );
    expect(screen.queryByRole("button", { name: /link|image|code|heading/i })).toBeNull();
  });

  it("translates the typography controls through the admin dictionary", async () => {
    setAdminLang("zh");
    renderWithI18n(
      <AnnouncementRichTextEditor
        itemId={ITEM_ONE}
        fallbackText="Offer"
        onChange={vi.fn()}
      />,
    );
    await editor("公告富文本");

    expect(screen.getByRole("toolbar", { name: "公告文字排版" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "字体" })).toBeVisible();
    expect(screen.getByRole("button", { name: "粗体" })).toBeVisible();
    expect(screen.getByRole("button", { name: "水平居中" })).toBeVisible();
    expect(screen.getByLabelText("高亮颜色")).toHaveAttribute("type", "color");
  });

  it("writes canonical JSON and synchronized fallback text once per typing burst", async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <AnnouncementRichTextEditor
        itemId={ITEM_ONE}
        fallbackText=""
        onChange={onChange}
      />,
    );
    const textbox = await editor();
    vi.useFakeTimers();

    fireEvent.paste(textbox, {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain" ? "Pasted safely" : "<img src=x onerror=alert(1)>",
      },
    });
    expect(onChange).not.toHaveBeenCalled();
    await flushEditorCommit();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      content: {
        version: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { textAlign: "center" },
              content: [{ type: "text", text: "Pasted safely" }],
            },
          ],
        },
      },
      text: "Pasted safely",
    });
  });

  it("sanitizes pasted HTML, links and excess blocks before committing", async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <AnnouncementRichTextEditor
        itemId={ITEM_ONE}
        fallbackText=""
        onChange={onChange}
      />,
    );
    const textbox = await editor();
    vi.useFakeTimers();
    const longText = `${"x".repeat(100)}\n${"y".repeat(100)}\nignored`;

    fireEvent.paste(textbox, {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain"
            ? longText
            : '<a href="javascript:alert(1)" style="position:fixed">unsafe</a>',
      },
    });
    await flushEditorCommit();

    const value = onChange.mock.calls[0][0];
    expect(value.text).toHaveLength(200);
    expect(value.content.doc.content).toHaveLength(2);
    expect(JSON.stringify(value)).not.toMatch(/javascript|position|href|ignored/);
  });

  it("keeps editor undo shortcuts local while allowing the global save shortcut", async () => {
    const parentKeyDown = vi.fn();
    renderWithI18n(
      <div onKeyDown={parentKeyDown}>
        <AnnouncementRichTextEditor
          itemId={ITEM_ONE}
          fallbackText="Offer"
          onChange={vi.fn()}
        />
      </div>,
    );
    const textbox = await editor();

    fireEvent.keyDown(textbox, { key: "z", ctrlKey: true });
    fireEvent.keyDown(textbox, { key: "Delete" });
    expect(parentKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(textbox, { key: "s", ctrlKey: true });
    expect(parentKeyDown).toHaveBeenCalledTimes(1);
  });

  it("flushes the old item before adopting a different item id", async () => {
    const firstChange = vi.fn();
    const secondChange = vi.fn();
    const view = renderWithI18n(
      <AnnouncementRichTextEditor
        key={ITEM_ONE}
        itemId={ITEM_ONE}
        fallbackText=""
        onChange={firstChange}
      />,
    );
    const firstEditor = await editor();
    vi.useFakeTimers();
    fireEvent.paste(firstEditor, {
      clipboardData: { getData: (type: string) => (type === "text/plain" ? "First" : "") },
    });

    view.rerender(
      <AnnouncementRichTextEditor
        key={ITEM_TWO}
        itemId={ITEM_TWO}
        fallbackText="Second"
        onChange={secondChange}
      />,
    );
    expect(firstChange).toHaveBeenCalledTimes(1);
    expect(firstChange).toHaveBeenCalledWith(
      expect.objectContaining({ text: "First" }),
    );
    vi.useRealTimers();
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Announcement rich text" }),
      ).toHaveTextContent("Second"),
    );
    expect(secondChange).not.toHaveBeenCalled();
  });
});
