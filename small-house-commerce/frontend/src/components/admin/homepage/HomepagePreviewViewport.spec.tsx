import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomepagePreviewViewport } from "./HomepagePreviewViewport";

const src = "/preview/homepage?token=test-token&view=content";

const DEVICES = [
  ["desktop", "Desktop homepage draft preview", 1440, 900],
  ["tablet", "Tablet homepage draft preview", 768, 1024],
  ["mobile", "Mobile homepage draft preview", 390, 844],
] as const;

describe("HomepagePreviewViewport", () => {
  it.each(DEVICES)(
    "renders the %s draft in the same device frame the builder canvas uses",
    (view, title, width, height) => {
      const { container } = render(<HomepagePreviewViewport view={view} src={src} />);
      const frame = screen.getByTitle(title);
      expect(frame).toHaveAttribute("src", src);
      expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");

      // The draft renders inside the device viewport, not the browser window:
      // the hero geometry the shopper gets must be the geometry the canvas
      // shows, otherwise the preview crops the hero image differently.
      const device = container.querySelector("[data-preview-viewport]") as HTMLElement;
      expect(device).not.toBeNull();
      expect(device).toHaveStyle({ width: `${width}px`, height: `${height}px` });
      expect(frame.parentElement).toBe(device);

      // The device is scaled down to fit the window, never blown up.
      const scale = Number.parseFloat(device.style.transform.replace("scale(", ""));
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeLessThanOrEqual(1);
      expect(scale).toBeGreaterThan(0);

      expect(container.querySelector("[data-draft-preview-banner]")?.contains(frame)).toBe(false);
      expect(container.querySelector("[data-preview-stage]")?.contains(frame)).toBe(true);
    },
  );

  it("offers a back-to-editor link that never carries the signed token", () => {
    render(<HomepagePreviewViewport view="desktop" src={src} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("返回装修工作台");
    expect(links[0]).toHaveAttribute("href", "/admin/homepage");
    expect(links[0].getAttribute("href")).not.toContain("token");
    expect(document.documentElement.outerHTML).not.toContain("/admin/homepage?");
  });

  it("switches device frames in place without re-requesting or rewriting the content URL", () => {
    const { container } = render(<HomepagePreviewViewport view="desktop" src={src} />);
    const group = screen.getByRole("group", { name: "预览设备" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(within(group).getByRole("button", { name: "电脑" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("[data-preview-view]")).toHaveAttribute("data-preview-view", "desktop");

    fireEvent.click(within(group).getByRole("button", { name: "手机" }));
    const mobile = screen.getByTitle("Mobile homepage draft preview");
    expect(mobile).toHaveAttribute("src", src);
    expect(container.querySelector("[data-preview-viewport]")).toHaveStyle({ width: "390px", height: "844px" });
    expect(within(group).getByRole("button", { name: "手机" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("[data-preview-view]")).toHaveAttribute("data-preview-view", "mobile");
    expect(screen.getByText("草稿预览 · 未发布 · 手机视口（最大 390px）")).toBeInTheDocument();

    fireEvent.click(within(group).getByRole("button", { name: "平板" }));
    expect(container.querySelector("[data-preview-viewport]")).toHaveStyle({ width: "768px", height: "1024px" });
    expect(screen.getByTitle("Tablet homepage draft preview")).toHaveAttribute("src", src);
  });
});
