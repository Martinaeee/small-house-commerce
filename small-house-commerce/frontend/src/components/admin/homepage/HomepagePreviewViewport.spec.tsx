import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomepagePreviewViewport } from "./HomepagePreviewViewport";

const src = "/preview/homepage?token=test-token&view=content";

describe("HomepagePreviewViewport", () => {
  it.each([
    ["desktop", "Desktop homepage draft preview", "100%"],
    ["tablet", "Tablet homepage draft preview", "min(768px, 100%)"],
    ["mobile", "Mobile homepage draft preview", "min(390px, 100%)"],
  ] as const)("creates an unscaled %s iframe with an accessible title and private referrer policy", (view, title, width) => {
    const { container } = render(<HomepagePreviewViewport view={view} src={src} />);
    const frame = screen.getByTitle(title);
    expect(frame).toHaveAttribute("src", src);
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).toHaveStyle({ width, height: "100%" });
    expect((frame as HTMLElement).style.borderWidth).toBe("0px");
    expect((frame as HTMLElement).style.transform).toBe("");
    expect(container.querySelector("[data-draft-preview-banner]")?.contains(frame)).toBe(false);
    expect(container.querySelector("[data-preview-stage]")?.contains(frame)).toBe(true);
  });

  it("offers a back-to-editor link that never carries the signed token", () => {
    render(<HomepagePreviewViewport view="desktop" src={src} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("返回装修工作台");
    expect(links[0]).toHaveAttribute("href", "/admin/homepage");
    expect(links[0].getAttribute("href")).not.toContain("token");
    expect(document.documentElement.outerHTML).not.toContain("/admin/homepage?");
  });

  it("switches device widths in place without re-requesting or rewriting the content URL", () => {
    const { container } = render(<HomepagePreviewViewport view="desktop" src={src} />);
    const group = screen.getByRole("group", { name: "预览设备" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(within(group).getByRole("button", { name: "电脑" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("[data-preview-view]")).toHaveAttribute("data-preview-view", "desktop");

    fireEvent.click(within(group).getByRole("button", { name: "手机" }));
    const mobile = screen.getByTitle("Mobile homepage draft preview");
    expect(mobile).toHaveAttribute("src", src);
    expect(mobile).toHaveStyle({ width: "min(390px, 100%)" });
    expect(within(group).getByRole("button", { name: "手机" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("[data-preview-view]")).toHaveAttribute("data-preview-view", "mobile");
    expect(screen.getByText("草稿预览 · 未发布 · 手机视口（最大 390px）")).toBeInTheDocument();

    fireEvent.click(within(group).getByRole("button", { name: "平板" }));
    expect(screen.getByTitle("Tablet homepage draft preview")).toHaveStyle({ width: "min(768px, 100%)" });
    expect(screen.getByTitle("Tablet homepage draft preview")).toHaveAttribute("src", src);
  });
});
