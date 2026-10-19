import { useEffect, useState, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import {
  emptyDocument,
  type AnnouncementItem,
  type HeroSlide,
  type HomepageDocument,
} from "@/lib/homepage-document";
import {
  HomepageEditorProvider,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import {
  ANNOUNCEMENT_SELECTION_ID,
} from "@/components/admin/homepage/ModuleTree";
import {
  datetimeLocalToIso,
  PublishPanel,
} from "@/components/admin/homepage/PublishPanel";

const validateHomepage = vi.hoisted(() => vi.fn());
const publishHomepage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: { validateHomepage, publishHomepage },
}));

const HERO_ID = "00000000-0000-7000-8000-000000000001";
const SLIDE_ONE_ID = "00000000-0000-7000-8000-000000000010";
const SLIDE_TWO_ID = "00000000-0000-7000-8000-000000000011";
const SLIDE_THREE_ID = "00000000-0000-7000-8000-000000000012";
const ANNOUNCEMENT_ITEM_ID = "00000000-0000-7000-8000-000000000020";
const scrollIntoView = vi.fn();

function heroSlide(id: string, heading: string): HeroSlide {
  const section = emptyDocument().sections[0];
  if (section.type !== "HERO") throw new Error("fixture expects a HERO section");
  const slide = structuredClone(section.payload.slides[0]);
  slide.id = id;
  slide.elements.heading.text = heading;
  return slide;
}

function announcementItem(id: string, text: string): AnnouncementItem {
  return {
    id,
    text,
    link: null,
    linkLabel: null,
    textColor: "#1F2937",
    backgroundColor: "#E8EEF4",
    schedule: { publishAt: null, unpublishAt: null },
    enabled: true,
    sortOrder: 0,
  };
}

/** 3 hero slides + 2 announcement items so the auto note summary has counts. */
function countedDocument(): HomepageDocument {
  const doc = emptyDocument();
  const hero = doc.sections[0];
  if (hero.type !== "HERO") throw new Error("fixture expects a HERO section");
  hero.payload.slides = [
    heroSlide(SLIDE_ONE_ID, "First"),
    heroSlide(SLIDE_TWO_ID, "Second"),
    heroSlide(SLIDE_THREE_ID, "Third"),
  ];
  doc.announcement.items = [
    announcementItem("00000000-0000-7000-8000-000000000020", "Free shipping"),
    announcementItem("00000000-0000-7000-8000-000000000021", "New arrivals"),
  ];
  return doc;
}

function DocumentLoader({ document }: { document: HomepageDocument }): null {
  const { dispatch } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 5, savedAt: null });
  }, [dispatch, document]);
  return null;
}

function SelectionProbe(): ReactNode {
  const {
    selectedSectionId,
    selectedSlideId,
    selectedElementKey,
    setSelectedElementKey,
  } = useHomepageEditor();
  return (
    <div>
      <span data-testid="selected-section">{selectedSectionId ?? ""}</span>
      <span data-testid="selected-slide">{selectedSlideId ?? ""}</span>
      <span data-testid="selected-element">{selectedElementKey ?? ""}</span>
      <div
        data-item-id={ANNOUNCEMENT_ITEM_ID}
        ref={(node) => {
          if (node) node.scrollIntoView = scrollIntoView;
        }}
      />
      <button
        type="button"
        onClick={() => setSelectedElementKey("heading")}
      >
        select-element
      </button>
    </div>
  );
}

type HarnessOptions = {
  document?: HomepageDocument;
  save?: () => Promise<boolean>;
  onClose?: () => void;
  onPublished?: (result: { versionNo: number; publishAt: string }) => void;
};

type SaveFn = () => Promise<boolean>;

function renderPanel(options: HarnessOptions = {}) {
  const save: Mock<SaveFn> = options.save
    ? vi.fn(options.save)
    : vi.fn<SaveFn>().mockResolvedValue(true);
  const onClose = options.onClose ?? vi.fn();
  const onPublished = options.onPublished ?? vi.fn();
  const onRevealSettings = vi.fn();
  const scrollSettings = vi.fn();
  function Harness() {
    const [visible, setVisible] = useState(false);
    return <>
      <PublishPanel save={save} onClose={onClose} onPublished={onPublished} onRevealSettings={() => { onRevealSettings(); setVisible(true); }} />
      <SelectionProbe />
      {visible ? <section data-homepage-settings-scroll ref={(node) => { if (node) node.scrollTo = scrollSettings; }}>
        <details data-testid="entry-group"><summary>Entries</summary>
          <div data-entry-id="navigation-entry" data-testid="navigation-entry" />
        </details>
      </section> : null}
      <div data-entry-id="navigation-entry" data-testid="outside-entry" />
    </>;
  }
  render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <DocumentLoader document={options.document ?? countedDocument()} />
        <Harness />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
  return { save, onClose, onPublished, onRevealSettings, scrollSettings };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const PUBLISH_BUTTON = "Publish";
const CONFIRM_BUTTON = "Confirm risks and publish";

function publishButton(): HTMLElement {
  return screen.getByRole("button", { name: /^(Publish|Confirm risks and publish)$/ });
}

describe("PublishPanel", () => {
  beforeEach(() => {
    setAdminLang("en");
    scrollIntoView.mockReset();
    validateHomepage.mockReset();
    publishHomepage.mockReset();
    validateHomepage.mockResolvedValue({ errors: [], warnings: [] });
    publishHomepage.mockResolvedValue({
      versionNo: 7,
      publishAt: "2026-10-01T09:30:00.000Z",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defaults the note to the auto summary with hero slide and announcement counts", async () => {
    renderPanel();
    await flush();

    expect(screen.getByLabelText("Note (optional)")).toHaveValue(
      "Hero: 3 slides; Announcement: 2 items",
    );
  });

  it("saves the draft before validating the draft on open", async () => {
    const { save } = renderPanel();
    await flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(validateHomepage).toHaveBeenCalledTimes(1);
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      validateHomepage.mock.invocationCallOrder[0],
    );
  });

  it("aborts with a readable error when the pre-publish save fails", async () => {
    const save = vi.fn().mockResolvedValue(false);
    renderPanel({ save });
    await flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(validateHomepage).not.toHaveBeenCalled();
    expect(
      screen.getByText("The draft could not be saved, so publishing was cancelled."),
    ).toBeVisible();
    expect(publishButton()).toBeDisabled();
  });

  it("blocks publish and lists errors with a working jump-to-slide action", async () => {
    validateHomepage.mockResolvedValue({
      errors: [
        {
          severity: "ERROR",
          code: "HERO_SLIDE_MEDIA_MISSING",
          message: "Enabled slide has no media.",
          sectionId: HERO_ID,
          slideId: SLIDE_TWO_ID,
        },
        {
          severity: "ERROR",
          code: "HERO_HEADING_REQUIRED",
          message: "Enabled slide heading is required.",
          sectionId: HERO_ID,
          slideId: SLIDE_THREE_ID,
        },
      ],
      warnings: [],
    });
    const onClose = vi.fn();
    renderPanel({ onClose });
    await flush();

    expect(screen.getByText("Errors (2)")).toBeVisible();
    expect(screen.getByText("Enabled slide has no media.")).toBeVisible();
    expect(screen.getByText("2 error(s) block publishing.")).toBeVisible();
    expect(publishButton()).toBeDisabled();
    expect(publishHomepage).not.toHaveBeenCalled();

    const jumpButtons = screen.getAllByRole("button", { name: "Go to slide" });
    expect(jumpButtons).toHaveLength(2);

    // Pre-select an element so the jump action has something to clear.
    fireEvent.click(screen.getByRole("button", { name: "select-element" }));
    expect(screen.getByTestId("selected-element")).toHaveTextContent("heading");

    fireEvent.click(jumpButtons[0]);
    expect(screen.getByTestId("selected-section")).toHaveTextContent(HERO_ID);
    expect(screen.getByTestId("selected-slide")).toHaveTextContent(SLIDE_TWO_ID);
    expect(screen.getByTestId("selected-element")).toBeEmptyDOMElement();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reveals settings, selects the affected module and scrolls only its entry after the dialog closes", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    validateHomepage.mockResolvedValue({ errors: [{ severity: "ERROR", code: "NAVIGATION_IMAGE_REQUIRED", message: "Entry needs an image.", sectionId: "navigation-section", entryId: "navigation-entry" }], warnings: [] });
    const { onRevealSettings, onClose, scrollSettings } = renderPanel();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Go to slide" }));
    const pane = document.querySelector<HTMLElement>("[data-homepage-settings-scroll]")!;
    expect(pane).not.toBeNull();
    expect(screen.getByTestId("selected-section")).toHaveTextContent("navigation-section");
    expect(onRevealSettings.mock.invocationCallOrder[0]).toBeLessThan((onClose as Mock).mock.invocationCallOrder[0]);
    const row = screen.getByTestId("navigation-entry");
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({ top: 40 } as DOMRect);
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 500, height: 60 } as DOMRect);
    Object.defineProperty(pane, "clientHeight", { value: 200 });
    pane.scrollTop = 100;
    act(() => { frames.shift()?.(0); frames.shift()?.(0); });
    expect(screen.getByTestId("entry-group")).toHaveAttribute("open");
    expect(scrollSettings).toHaveBeenCalledWith({ top: 490, behavior: "smooth" });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it.each(["removed-entry", 'missing\"] [data-entry-id=\"navigation-entry']) ("ignores unknown or selector-like entry ids safely: %s", async (entryId) => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    validateHomepage.mockResolvedValue({ errors: [{ severity: "ERROR", code: "NAVIGATION_IMAGE_REQUIRED", message: "Entry needs an image.", sectionId: "navigation-section", entryId }], warnings: [] });
    const { scrollSettings } = renderPanel();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Go to slide" }));
    expect(() => act(() => { frames.shift()?.(0); frames.shift()?.(0); })).not.toThrow();
    expect(screen.getByTestId("selected-section")).toHaveTextContent("navigation-section");
    expect(scrollSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId("entry-group")).not.toHaveAttribute("open");
  });

  it("jumps announcement issues to the affected item after closing the dialog", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    validateHomepage.mockResolvedValue({
      errors: [
        {
          severity: "ERROR",
          code: "ANNOUNCEMENT_END_REQUIRED",
          message: "Countdown needs an end time.",
          announcementItemId: ANNOUNCEMENT_ITEM_ID,
        },
      ],
      warnings: [],
    });
    const onClose = vi.fn();
    renderPanel({ onClose });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Go to item" }));

    expect(screen.getByTestId("selected-section")).toHaveTextContent(
      ANNOUNCEMENT_SELECTION_ID,
    );
    expect(screen.getByTestId("selected-slide")).toBeEmptyDOMElement();
    expect(screen.getByTestId("selected-element")).toBeEmptyDOMElement();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "smooth",
    });
  });

  it("requires explicit confirmation before publishing with warnings", async () => {
    validateHomepage.mockResolvedValue({
      errors: [],
      warnings: [
        {
          severity: "WARNING",
          code: "HERO_MEDIA_ALT_MISSING",
          message: "Image is missing alt text.",
          sectionId: HERO_ID,
          slideId: SLIDE_ONE_ID,
        },
      ],
    });
    renderPanel();
    await flush();

    expect(screen.getByText("Warnings (1)")).toBeVisible();
    expect(screen.getByText("Image is missing alt text.")).toBeVisible();

    // Unconfirmed: the publish control is the explicit confirm copy and does
    // not publish yet.
    expect(
      screen.getByRole("button", { name: CONFIRM_BUTTON }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_BUTTON }));
    await flush();
    expect(publishHomepage).not.toHaveBeenCalled();

    // Confirmed: the plain publish button now sends confirmWarnings.
    fireEvent.click(screen.getByRole("button", { name: PUBLISH_BUTTON }));
    await flush();
    expect(publishHomepage).toHaveBeenCalledTimes(1);
    expect(publishHomepage).toHaveBeenCalledWith(
      expect.objectContaining({ confirmWarnings: true }),
    );
  });

  it("publishes immediately without confirmation when there are no warnings", async () => {
    const onPublished = vi.fn();
    renderPanel({ onPublished });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: PUBLISH_BUTTON }));
    await flush();

    expect(publishHomepage).toHaveBeenCalledTimes(1);
    expect(publishHomepage).toHaveBeenCalledWith({
      note: "Hero: 3 slides; Announcement: 2 items",
      publishAt: null,
      unpublishAt: null,
      confirmWarnings: false,
    });
    expect(
      screen.getByText(/Published version 7\./),
    ).toBeVisible();
    expect(onPublished).toHaveBeenCalledWith({
      versionNo: 7,
      publishAt: "2026-10-01T09:30:00.000Z",
    });
  });

  it("converts datetime-local values to offset ISO strings for scheduling", async () => {
    renderPanel();
    await flush();

    fireEvent.change(screen.getByLabelText("Publish at (empty = now)"), {
      target: { value: "2026-10-01T09:30" },
    });
    fireEvent.change(screen.getByLabelText("Unpublish at (optional)"), {
      target: { value: "2026-10-08T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: PUBLISH_BUTTON }));
    await flush();

    expect(publishHomepage).toHaveBeenCalledWith(
      expect.objectContaining({
        publishAt: new Date("2026-10-01T09:30").toISOString(),
        unpublishAt: new Date("2026-10-08T09:30").toISOString(),
      }),
    );
  });

  it("blocks submission when unpublish time is not after publish time", async () => {
    renderPanel();
    await flush();

    fireEvent.change(screen.getByLabelText("Publish at (empty = now)"), {
      target: { value: "2026-10-08T09:30" },
    });
    fireEvent.change(screen.getByLabelText("Unpublish at (optional)"), {
      target: { value: "2026-10-01T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: PUBLISH_BUTTON }));
    await flush();

    expect(publishHomepage).not.toHaveBeenCalled();
    expect(
      screen.getByText("Unpublish time must be later than publish time."),
    ).toBeVisible();
  });

  it("re-runs validation on a 422 and renders the fresh issues without parsing error details", async () => {
    validateHomepage
      .mockResolvedValueOnce({ errors: [], warnings: [] })
      .mockResolvedValueOnce({
        errors: [],
        warnings: [
          {
            severity: "WARNING",
            code: "HERO_MEDIA_ALT_MISSING",
            message: "Fresh warning from the server.",
            sectionId: HERO_ID,
            slideId: SLIDE_ONE_ID,
          },
        ],
      });
    publishHomepage.mockRejectedValue(
      new AdminApiError("Warnings need confirmation", 422, {
        issues: [
          { severity: "WARNING", code: "X", message: "DETAILS-MUST-NOT-RENDER" },
        ],
      }),
    );
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: PUBLISH_BUTTON }));
    await flush();

    expect(validateHomepage).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Publishing was rejected; review the check results below."),
    ).toBeVisible();
    expect(screen.getByText("Fresh warning from the server.")).toBeVisible();
    expect(screen.queryByText("DETAILS-MUST-NOT-RENDER")).not.toBeInTheDocument();
    // The panel stays mounted (dialog not closed) and re-arms the confirm flow.
    expect(
      screen.getByRole("button", { name: CONFIRM_BUTTON }),
    ).toBeVisible();
    expect(screen.getByLabelText("Note (optional)")).toBeVisible();
  });

  it("shows a readable error for non-422 publish failures", async () => {
    publishHomepage.mockRejectedValue(new AdminApiError("Server exploded", 500));
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: PUBLISH_BUTTON }));
    await flush();

    expect(screen.getByText("Action failed: Server exploded")).toBeVisible();
  });

  it("links to the versions page", async () => {
    renderPanel();
    await flush();

    expect(screen.getByRole("link", { name: "Versions" })).toHaveAttribute(
      "href",
      "/admin/homepage/versions",
    );
  });
});

describe("datetimeLocalToIso", () => {
  it("maps empty input to null, valid input to offset ISO and rejects junk", () => {
    expect(datetimeLocalToIso("")).toBeNull();
    expect(datetimeLocalToIso("2026-10-01T09:30")).toBe(
      new Date("2026-10-01T09:30").toISOString(),
    );
    expect(datetimeLocalToIso("not-a-date")).toBe("invalid");
    expect(datetimeLocalToIso("2026-13-45T99:99")).toBe("invalid");
  });
});
