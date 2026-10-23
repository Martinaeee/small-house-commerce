import { useEffect, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { HomepageEditorProvider, useHomepageEditor } from "./HomepageEditor";
import { HeroLinkSettings } from "./HeroLinkSettings";
import {
  emptyDocument,
  type HomepageDocument,
} from "@/lib/homepage-document";

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    listProducts: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    listCategories: vi.fn().mockResolvedValue([]),
    listCollections: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
    listLandingPages: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getProduct: vi.fn().mockRejectedValue(new Error("not found")),
  },
}));

const SLIDE = "00000000-0000-7000-8000-000000000111";

function fixture(): HomepageDocument {
  const document = emptyDocument();
  const hero = document.sections[0];
  if (hero.type !== "HERO") throw new Error("expected Hero");
  hero.payload.slides[0].id = SLIDE;
  hero.payload.slides[0].name = "Calmer mornings";
  return document;
}

function Setup({ document }: { document: HomepageDocument }): ReactNode {
  const { dispatch, setSelectedSlideId } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 3, savedAt: null });
    setSelectedSlideId(SLIDE);
  }, [dispatch, document, setSelectedSlideId]);
  return null;
}

function Probe(): ReactNode {
  const { state, zoneToolArmed } = useHomepageEditor();
  return (
    <div>
      <pre data-testid="document">{JSON.stringify(state.document)}</pre>
      <span data-testid="zone-tool">{zoneToolArmed ? "armed" : "idle"}</span>
    </div>
  );
}

function mount(document = fixture()) {
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Setup document={document} />
        <HeroLinkSettings />
        <Probe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function current(): HomepageDocument {
  return JSON.parse(screen.getByTestId("document").textContent ?? "{}");
}

function slide() {
  const hero = current().sections[0];
  if (hero.type !== "HERO") throw new Error("expected Hero");
  return hero.payload.slides[0];
}

beforeEach(() => {
  setAdminLang("en");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HeroLinkSettings", () => {
  it("switches the slide between button links and a whole-banner link", () => {
    mount();

    expect(slide().linkMode ?? "BUTTON").toBe("BUTTON");
    fireEvent.click(screen.getByRole("radio", { name: "Whole banner" }));
    expect(slide().linkMode).toBe("SLIDE");

    fireEvent.click(screen.getByRole("radio", { name: "Buttons only" }));
    expect(slide().linkMode).toBe("BUTTON");
  });

  it("stores the whole-banner target picked from the link list", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Whole banner" }));

    const picker = screen.getByRole("combobox", { name: "Link type" });
    fireEvent.change(picker, { target: { value: "EXTERNAL" } });
    const url = screen.getByRole("textbox", { name: "External URL (https only)" });
    fireEvent.change(url, { target: { value: "https://example.com/collection" } });
    fireEvent.blur(url);

    expect(slide().slideLink).toEqual({
      type: "EXTERNAL",
      url: "https://example.com/collection",
    });
  });

  it("arms the box-select tool so the operator can drag an area on the picture", () => {
    mount();

    expect(screen.getByTestId("zone-tool").textContent).toBe("idle");
    const draw = screen.getByRole("button", { name: "Box an area on the picture" });
    fireEvent.click(draw);

    expect(screen.getByTestId("zone-tool").textContent).toBe("armed");
    expect(draw).toHaveAttribute("aria-pressed", "true");
    // The hint tells the operator what to do next.
    expect(screen.getByText(/drag over the picture/i)).toBeInTheDocument();
  });

  it("adds a link zone, gives it a target and shows its background", () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Add a link zone" }));
    expect(slide().zones).toHaveLength(1);

    const zone = slide().zones?.[0];
    expect(zone?.background).toEqual({ visible: false, color: "#c9a77b" });

    const picker = within(
      document.querySelector<HTMLElement>('[data-hero-zone-settings]')!,
    ).getByRole("combobox", { name: "Link type" });
    fireEvent.change(picker, { target: { value: "EXTERNAL" } });
    const url = within(
      document.querySelector<HTMLElement>('[data-hero-zone-settings]')!,
    ).getByRole("textbox", { name: "External URL (https only)" });
    fireEvent.change(url, { target: { value: "https://example.com/sale" } });
    fireEvent.blur(url);

    expect(slide().zones?.[0].link).toEqual({
      type: "EXTERNAL",
      url: "https://example.com/sale",
    });

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show background" }),
    );
    expect(slide().zones?.[0].background.visible).toBe(true);
  });

  it("deletes a link zone", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Add a link zone" }));
    expect(slide().zones).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete zone" }));
    expect(slide().zones).toHaveLength(0);
  });
});
