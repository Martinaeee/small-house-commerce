import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditorProvider,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import { AnnouncementSettings } from "@/components/admin/homepage/AnnouncementSettings";
import {
  emptyDocument,
  type AnnouncementBlock,
  type AnnouncementItem,
  type HomepageDocument,
} from "@/lib/homepage-document";
import type { AdminProduct } from "@/lib/admin-api";

const listProducts = vi.hoisted(() => vi.fn());
const listCategories = vi.hoisted(() => vi.fn());
const listCollections = vi.hoisted(() => vi.fn());
const listLandingPages = vi.hoisted(() => vi.fn());
const getProduct = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    listProducts,
    listCategories,
    listCollections,
    listLandingPages,
    getProduct,
  },
}));

const ITEM_ONE_ID = "00000000-0000-7000-8000-000000000201";
const ITEM_TWO_ID = "00000000-0000-7000-8000-000000000202";
const PRODUCT_UUID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  listCollections.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  listCategories.mockResolvedValue([]);
  listLandingPages.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  getProduct.mockReset();
  getProduct.mockRejectedValue(new Error("not found"));
});

function announcementItem(
  id: string,
  sortOrder: number,
  overrides: Partial<AnnouncementItem> = {},
): AnnouncementItem {
  return {
    id,
    text: `Message ${sortOrder}`,
    link: null,
    linkLabel: null,
    textColor: "#292724",
    backgroundColor: "#F2EFE9",
    schedule: { publishAt: null, unpublishAt: null },
    enabled: true,
    sortOrder,
    ...overrides,
  };
}

function settingsDocument(
  announcement: Partial<AnnouncementBlock> = {},
): HomepageDocument {
  return {
    ...emptyDocument(),
    announcement: {
      enabled: true,
      rotationMs: 5000,
      items: [
        announcementItem(ITEM_ONE_ID, 0, { text: "Free shipping" }),
        announcementItem(ITEM_TWO_ID, 10, { text: "10.10 sale" }),
      ],
      ...announcement,
    },
  };
}

const DOCUMENT = settingsDocument();

function Loader({ document }: { document: HomepageDocument }): ReactNode {
  const { dispatch } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 3, savedAt: null });
  }, [dispatch, document]);
  return null;
}

function SettingsProbe(): ReactNode {
  const { state } = useHomepageEditor();
  return (
    <div>
      <pre data-testid="announcement">
        {JSON.stringify(state.document.announcement)}
      </pre>
      <span data-testid="commits">{state.past.length}</span>
    </div>
  );
}

function renderSettings(document: HomepageDocument = DOCUMENT) {
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Loader document={document} />
        <AnnouncementSettings />
        <SettingsProbe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function announcement(): AnnouncementBlock {
  return JSON.parse(
    screen.getByTestId("announcement").textContent ?? "{}",
  ) as AnnouncementBlock;
}

function itemCard(itemId: string): HTMLElement {
  const card = document.querySelector(`[data-item-id="${itemId}"]`);
  if (!(card instanceof HTMLElement)) {
    throw new Error(`announcement item card ${itemId} not found`);
  }
  return card;
}

function commits(): string {
  return screen.getByTestId("commits").textContent ?? "";
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("AnnouncementSettings", () => {
  beforeEach(() => {
    setAdminLang("en");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds an item, applies a palette colour and reorders items", async () => {
    renderSettings();

    expect(announcement().items).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    expect(announcement().items).toHaveLength(3);
    const added = announcement().items[2];
    expect(added.text.length).toBeGreaterThan(0);
    expect(added.backgroundColor).toBe("#F2EFE9");

    fireEvent.click(
      within(itemCard(ITEM_ONE_ID)).getByRole("button", {
        name: "Background #E8EEF4",
      }),
    );

    expect(announcement().items[0].backgroundColor).toBe("#E8EEF4");
    expect(announcement().items[1].backgroundColor).toBe("#F2EFE9");

    fireEvent.click(
      within(itemCard(ITEM_TWO_ID)).getByRole("button", { name: "Move up" }),
    );

    expect(announcement().items.map((item) => item.id)).toEqual([
      ITEM_TWO_ID,
      ITEM_ONE_ID,
      added.id,
    ]);
    expect(announcement().items.map((item) => item.sortOrder)).toEqual([
      0, 10, 20,
    ]);
  });

  it("edits a schedule through both datetime-local inputs and stores ISO strings", async () => {
    renderSettings();

    const card = itemCard(ITEM_ONE_ID);
    const start = within(card).getByLabelText("Start time");
    const end = within(card).getByLabelText("End time");
    expect(start).toHaveAttribute("type", "datetime-local");
    expect(end).toHaveAttribute("type", "datetime-local");
    expect(start).toHaveValue("");

    fireEvent.change(start, { target: { value: "2026-10-01T09:30" } });
    expect(announcement().items[0].schedule.publishAt).toBe(
      new Date("2026-10-01T09:30").toISOString(),
    );

    fireEvent.change(end, { target: { value: "2026-10-05T18:00" } });
    expect(announcement().items[0].schedule.unpublishAt).toBe(
      new Date("2026-10-05T18:00").toISOString(),
    );

    // Never store the raw datetime-local string.
    expect(announcement().items[0].schedule.publishAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );

    fireEvent.change(start, { target: { value: "" } });
    expect(announcement().items[0].schedule.publishAt).toBeNull();
    expect(announcement().items[0].schedule.unpublishAt).toBe(
      new Date("2026-10-05T18:00").toISOString(),
    );
  });

  it("shows a stored ISO timestamp back as the local datetime-local value", async () => {
    const iso = "2026-10-01T01:30:00.000Z";
    renderSettings(
      settingsDocument({
        items: [
          announcementItem(ITEM_ONE_ID, 0, {
            schedule: { publishAt: iso, unpublishAt: null },
          }),
        ],
      }),
    );

    const start = within(itemCard(ITEM_ONE_ID)).getByLabelText(
      "Start time",
    ) as HTMLInputElement;
    expect(start.value).not.toBe("");
    expect(new Date(start.value).getTime()).toBe(new Date(iso).getTime());
  });

  it("commits one history entry for a rich-text editor burst", async () => {
    renderSettings();
    const textEditor = within(itemCard(ITEM_ONE_ID)).getByRole("textbox", {
      name: "Announcement rich text",
    });
    vi.useFakeTimers();

    fireEvent.keyDown(textEditor, { key: "a", ctrlKey: true });
    fireEvent.paste(textEditor, {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain" ? "Free shipping over $50" : "",
      },
    });

    expect(announcement().items[0].text).toBe("Free shipping");
    expect(commits()).toBe("0");

    await advance(299);
    expect(announcement().items[0].text).toBe("Free shipping");
    expect(commits()).toBe("0");

    await advance(1);
    expect(announcement().items[0]).toMatchObject({
      text: "Free shipping over $50",
      content: {
        version: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { textAlign: "center" },
              content: [{ type: "text", text: "Free shipping over $50" }],
            },
          ],
        },
      },
    });
    expect(commits()).toBe("1");

    fireEvent.blur(textEditor);
    expect(commits()).toBe("1");
  });

  it("commits a link label burst on blur without waiting for the timer", async () => {
    vi.useFakeTimers();
    renderSettings();

    const labelInput = within(itemCard(ITEM_ONE_ID)).getByRole("textbox", {
      name: "Link label",
    });
    fireEvent.change(labelInput, { target: { value: "Shop now" } });
    expect(commits()).toBe("0");

    fireEvent.blur(labelInput);
    expect(announcement().items[0].linkLabel).toBe("Shop now");
    expect(commits()).toBe("1");

    await advance(1000);
    expect(commits()).toBe("1");
  });

  it("keeps both rich-text edits when two debounce timers expire in the same flush", async () => {
    renderSettings();
    const first = within(itemCard(ITEM_ONE_ID)).getByRole("textbox", {
      name: "Announcement rich text",
    });
    const second = within(itemCard(ITEM_TWO_ID)).getByRole("textbox", {
      name: "Announcement rich text",
    });
    vi.useFakeTimers();

    fireEvent.keyDown(first, { key: "a", ctrlKey: true });
    fireEvent.paste(first, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "EDITED ONE" : ""),
      },
    });
    await advance(100);
    fireEvent.keyDown(second, { key: "a", ctrlKey: true });
    fireEvent.paste(second, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "EDITED TWO" : ""),
      },
    });

    await advance(300);

    expect(announcement().items[0].text).toBe("EDITED ONE");
    expect(announcement().items[1].text).toBe("EDITED TWO");
    expect(commits()).toBe("2");
  });

  it("keeps a buffered external link and a buffered hex edit when both timers expire together", async () => {
    vi.useFakeTimers();
    renderSettings();

    fireEvent.change(
      within(itemCard(ITEM_ONE_ID)).getByRole("combobox", {
        name: "Link type",
      }),
      { target: { value: "EXTERNAL" } },
    );
    const urlInput = within(itemCard(ITEM_ONE_ID)).getByRole("textbox", {
      name: "External URL (https only)",
    });
    const hexInput = within(itemCard(ITEM_TWO_ID)).getByRole("textbox", {
      name: "Text color",
    });

    fireEvent.change(urlInput, {
      target: { value: "https://example.com/sale" },
    });
    await advance(100);
    fireEvent.change(hexInput, { target: { value: "#112233" } });

    await advance(300);

    expect(announcement().items[0].link).toEqual({
      type: "EXTERNAL",
      url: "https://example.com/sale",
    });
    expect(announcement().items[1].textColor).toBe("#112233");
    expect(commits()).toBe("2");
  });

  it("commits a hex colour on a valid value and reverts invalid input on blur", async () => {
    vi.useFakeTimers();
    renderSettings();

    const hexInput = within(itemCard(ITEM_ONE_ID)).getByRole("textbox", {
      name: "Text color",
    });

    fireEvent.change(hexInput, { target: { value: "#11223" } });
    await advance(1000);
    expect(announcement().items[0].textColor).toBe("#292724");
    expect(commits()).toBe("0");

    fireEvent.change(hexInput, { target: { value: "#112233" } });
    await advance(300);
    expect(announcement().items[0].textColor).toBe("#112233");

    fireEvent.change(hexInput, { target: { value: "nope" } });
    fireEvent.blur(hexInput);
    expect(hexInput).toHaveValue("#112233");
    expect(announcement().items[0].textColor).toBe("#112233");
  });

  it("toggles the bar and the per-item enabled switches", async () => {
    renderSettings();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Enable announcement bar" }),
    );
    expect(announcement().enabled).toBe(false);

    fireEvent.click(
      within(itemCard(ITEM_ONE_ID)).getByRole("checkbox", {
        name: "Item enabled",
      }),
    );
    expect(announcement().items[0].enabled).toBe(false);
    expect(announcement().items[1].enabled).toBe(true);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Enable announcement bar" }),
    );
    expect(announcement().enabled).toBe(true);
    expect(commits()).toBe("3");
  });

  it("bounds the rotation slider to the backend range and commits changes", async () => {
    renderSettings();

    const slider = screen.getByRole("slider", {
      name: "Rotation interval (ms)",
    });
    expect(slider).toHaveAttribute("min", "2000");
    expect(slider).toHaveAttribute("max", "30000");
    expect(slider).toHaveValue("5000");

    fireEvent.change(slider, { target: { value: "8000" } });
    expect(announcement().rotationMs).toBe(8000);

    fireEvent.change(slider, { target: { value: "1000" } });
    expect(announcement().rotationMs).toBe(2000);

    fireEvent.change(slider, { target: { value: "99000" } });
    expect(announcement().rotationMs).toBe(30000);
  });

  it("commits an item link through the LinkPicker entity picker", async () => {
    vi.useFakeTimers();
    listProducts.mockResolvedValue({
      items: [
        {
          id: PRODUCT_UUID,
          name: "Oak Side Table",
        } as AdminProduct,
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderSettings();

    fireEvent.change(
      within(itemCard(ITEM_ONE_ID)).getByRole("combobox", {
        name: "Link type",
      }),
      { target: { value: "PRODUCT" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(
      within(screen.getByLabelText("Pick a Product")).getByRole("button", {
        name: "Oak Side Table",
      }),
    );

    expect(announcement().items[0].link).toEqual({
      type: "PRODUCT",
      id: PRODUCT_UUID,
    });
  });

  it("switches to external, validates https URLs and clears the link", async () => {
    renderSettings();

    const card = itemCard(ITEM_ONE_ID);
    const typeSelect = within(card).getByRole("combobox", { name: "Link type" });
    expect(typeSelect).toHaveValue("");

    fireEvent.change(typeSelect, { target: { value: "EXTERNAL" } });
    const urlInput = within(card).getByRole("textbox", {
      name: "External URL (https only)",
    });

    fireEvent.change(urlInput, { target: { value: "http://insecure.example" } });
    fireEvent.blur(urlInput);

    expect(announcement().items[0].link).toBeNull();
    expect(
      within(card).getByText("Only https:// links are allowed."),
    ).toBeVisible();

    fireEvent.change(urlInput, {
      target: { value: "https://example.com/landing" },
    });
    fireEvent.blur(urlInput);

    expect(announcement().items[0].link).toEqual({
      type: "EXTERNAL",
      url: "https://example.com/landing",
    });
    expect(
      within(card).queryByText("Only https:// links are allowed."),
    ).toBeNull();

    fireEvent.click(within(card).getByRole("button", { name: "Clear link" }));

    expect(announcement().items[0].link).toBeNull();
    expect(typeSelect).toHaveValue("");
  });

  it("configures a countdown, shows readiness feedback and renders an inert item preview", () => {
    renderSettings();
    const card = within(itemCard(ITEM_ONE_ID));

    expect(card.getByTestId("announcement-item-preview")).toHaveTextContent(
      "Free shipping",
    );
    fireEvent.click(card.getByRole("checkbox", { name: "Enable countdown" }));
    expect(announcement().items[0].countdown).toEqual({
      endsAt: null,
      color: null,
      fontFamily: "SANS",
      fontSize: "MD",
      fontWeight: 700,
    });
    expect(card.getByText("Set a future countdown deadline.")).toBeInTheDocument();

    const localDeadline = "2099-10-14T12:30";
    fireEvent.change(card.getByLabelText("Countdown deadline"), {
      target: { value: localDeadline },
    });
    fireEvent.change(card.getByRole("combobox", { name: "Countdown font" }), {
      target: { value: "POPPINS" },
    });
    fireEvent.change(card.getByRole("combobox", { name: "Countdown size" }), {
      target: { value: "LG" },
    });
    fireEvent.change(card.getByRole("combobox", { name: "Countdown weight" }), {
      target: { value: "800" },
    });
    fireEvent.change(card.getByLabelText("Countdown color"), {
      target: { value: "#112233" },
    });

    expect(announcement().items[0].countdown).toEqual({
      endsAt: new Date(localDeadline).toISOString(),
      color: "#112233",
      fontFamily: "POPPINS",
      fontSize: "LG",
      fontWeight: 800,
    });
    expect(card.queryByText("Set a future countdown deadline.")).toBeNull();
    expect(card.queryByRole("link")).toBeNull();

    fireEvent.click(card.getByRole("checkbox", { name: "Enable countdown" }));
    expect(announcement().items[0].countdown).toBeNull();
  });

  it("shows an entity-link CTA in the item preview without enabling navigation", () => {
    const document = settingsDocument();
    document.announcement.items[0].link = {
      type: "PRODUCT",
      id: PRODUCT_UUID,
    };
    document.announcement.items[0].linkLabel = "Shop now";
    renderSettings(document);

    const preview = within(itemCard(ITEM_ONE_ID)).getByTestId(
      "announcement-item-preview",
    );
    expect(preview).toHaveTextContent("Shop now");
    expect(preview.querySelector("a")).toBeNull();
  });

  it("picks item colours through the native colour input beside the palette", () => {
    renderSettings();

    const textSwatch = within(itemCard(ITEM_ONE_ID)).getByLabelText(
      "Text color: Pick color",
    );
    expect(textSwatch).toHaveAttribute("type", "color");
    expect(textSwatch).toHaveValue("#292724");

    fireEvent.change(textSwatch, { target: { value: "#112233" } });

    expect(announcement().items[0].textColor).toBe("#112233");
    expect(commits()).toBe("1");

    const backgroundSwatch = within(itemCard(ITEM_TWO_ID)).getByLabelText(
      "Background: Pick color",
    );
    // Stored "#F2EFE9" renders lowercase (native colour inputs are lowercase).
    expect(backgroundSwatch).toHaveValue("#f2efe9");

    fireEvent.change(backgroundSwatch, { target: { value: "#e8eef4" } });

    expect(announcement().items[1].backgroundColor).toBe("#e8eef4");
    expect(commits()).toBe("2");
  });
});
