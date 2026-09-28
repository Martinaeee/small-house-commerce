import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditorProvider,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import { HeroStyleSettings } from "@/components/admin/homepage/HeroStyleSettings";
import {
  emptyDocument,
  type HomepageDocument,
  type SliderBehavior,
  type SlideOverlay,
} from "@/lib/homepage-document";

const SLIDE_ID = "00000000-0000-7000-8000-000000000111";

function styleDocument(): HomepageDocument {
  const doc = emptyDocument();
  const hero = doc.sections[0];
  if (hero.type !== "HERO") throw new Error("fixture expects a HERO section");
  hero.payload.slides[0].id = SLIDE_ID;
  return doc;
}

function Harness({
  document,
  selectSlide = true,
}: {
  document: HomepageDocument;
  selectSlide?: boolean;
}): ReactNode {
  const { dispatch, setSelectedSlideId } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 7, savedAt: null });
    if (selectSlide) setSelectedSlideId(SLIDE_ID);
  }, [dispatch, document, selectSlide, setSelectedSlideId]);
  return null;
}

function StyleProbe(): ReactNode {
  const { state } = useHomepageEditor();
  const hero = state.document.sections.find((section) => section.type === "HERO");
  const slide =
    hero && hero.type === "HERO"
      ? hero.payload.slides.find((candidate) => candidate.id === SLIDE_ID)
      : undefined;
  return (
    <div>
      <pre data-testid="behavior">
        {JSON.stringify(hero && hero.type === "HERO" ? hero.payload.behavior : null)}
      </pre>
      <pre data-testid="overlay">{JSON.stringify(slide?.overlay ?? null)}</pre>
      <span data-testid="commits">{state.past.length}</span>
    </div>
  );
}

function renderStyleSettings(
  options: { document?: HomepageDocument; selectSlide?: boolean } = {},
) {
  const { document = styleDocument(), selectSlide = true } = options;
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Harness document={document} selectSlide={selectSlide} />
        <HeroStyleSettings />
        <StyleProbe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function behavior(): SliderBehavior {
  return JSON.parse(
    screen.getByTestId("behavior").textContent ?? "{}",
  ) as SliderBehavior;
}

function overlay(): SlideOverlay | null {
  return JSON.parse(
    screen.getByTestId("overlay").textContent ?? "null",
  ) as SlideOverlay | null;
}

function commits(): string {
  return screen.getByTestId("commits").textContent ?? "";
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("HeroStyleSettings", () => {
  beforeEach(() => {
    setAdminLang("en");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits behavior values and clamps the duration", async () => {
    vi.useFakeTimers();
    renderStyleSettings();

    expect(behavior().autoplay).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Autoplay" }));
    expect(behavior().autoplay).toBe(false);

    fireEvent.change(screen.getByRole("combobox", { name: "Transition" }), {
      target: { value: "SLIDE" },
    });
    expect(behavior().transition).toBe("SLIDE");

    fireEvent.click(screen.getByRole("checkbox", { name: "Pause on hover" }));
    expect(behavior().pauseOnHover).toBe(false);

    fireEvent.click(screen.getByRole("checkbox", { name: "Show arrows" }));
    expect(behavior().arrows).toBe(false);

    fireEvent.change(screen.getByRole("combobox", { name: "Pagination" }), {
      target: { value: "COUNTER" },
    });
    expect(behavior().pagination).toBe("COUNTER");

    const duration = screen.getByRole("textbox", {
      name: "Duration per slide (ms)",
    });
    fireEvent.change(duration, { target: { value: "99999" } });
    await advance(800);
    expect(behavior().durationMs).toBe(15000);

    fireEvent.change(duration, { target: { value: "1000" } });
    await advance(800);
    expect(behavior().durationMs).toBe(3000);

    const manualPause = screen.getByRole("textbox", {
      name: "Pause after manual switch (ms)",
    });
    fireEvent.change(manualPause, { target: { value: "99999" } });
    await advance(800);
    expect(behavior().manualPauseMs).toBe(60000);

    expect(commits()).toBe("8");
  });

  it("commits overlay edits for the selected slide", async () => {
    vi.useFakeTimers();
    renderStyleSettings();

    expect(overlay()).toEqual({ color: "#000000", opacity: 0.3, gradient: "BOTTOM" });

    const color = screen.getByRole("textbox", { name: "Overlay color" });
    fireEvent.change(color, { target: { value: "#112233" } });
    await advance(300);
    expect(overlay()?.color).toBe("#112233");

    const opacity = screen.getByRole("slider", { name: "Overlay opacity" });
    expect(opacity).toHaveAttribute("min", "0");
    expect(opacity).toHaveAttribute("max", "1");
    fireEvent.change(opacity, { target: { value: "0.75" } });
    await advance(800);
    expect(overlay()?.opacity).toBe(0.75);

    fireEvent.change(screen.getByRole("combobox", { name: "Overlay gradient" }), {
      target: { value: "FULL" },
    });
    expect(overlay()?.gradient).toBe("FULL");

    // A burst of slider moves coalesces into a single history entry.
    expect(commits()).toBe("3");
  });

  it("keeps the committed colour when the slider burst commits afterwards", async () => {
    vi.useFakeTimers();
    renderStyleSettings();

    const color = screen.getByRole("textbox", { name: "Overlay color" });
    fireEvent.change(color, { target: { value: "#445566" } });
    await advance(300);
    expect(overlay()?.color).toBe("#445566");

    // The slider patch must merge into the latest overlay (a patch built from
    // the pre-colour snapshot would silently drop the colour edit).
    const opacity = screen.getByRole("slider", { name: "Overlay opacity" });
    fireEvent.change(opacity, { target: { value: "0.6" } });
    await advance(800);

    expect(overlay()?.color).toBe("#445566");
    expect(overlay()?.opacity).toBe(0.6);
    expect(commits()).toBe("2");
  });

  it("hides the overlay group when no slide is selected", () => {
    renderStyleSettings({ selectSlide: false });

    expect(screen.getByText("Behavior")).toBeVisible();
    expect(screen.queryByText("Slide overlay")).toBeNull();
    expect(screen.queryByRole("slider", { name: "Overlay opacity" })).toBeNull();
  });
});
