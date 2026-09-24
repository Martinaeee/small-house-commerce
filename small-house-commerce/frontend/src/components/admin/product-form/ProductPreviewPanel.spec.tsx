import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { ProductPreviewPanel } from "@/components/admin/product-form/ProductPreviewPanel";
import { DeviceFrame } from "@/components/admin/PreviewPane";

function renderPanel(
  savedPreview: { path: string; status: "DRAFT" | "ACTIVE" | "DISABLED" } | null,
  currentSlug = "edited-slug",
  currentStatus: "DRAFT" | "ACTIVE" | "DISABLED" = "DRAFT",
) {
  return render(
    <AdminI18nProvider>
      <ProductPreviewPanel
        savedPreview={savedPreview}
        currentSlug={currentSlug}
        currentStatus={currentStatus}
      >
        <p>Unsaved live content</p>
      </ProductPreviewPanel>
    </AdminI18nProvider>,
  );
}

describe("ProductPreviewPanel", () => {
  beforeEach(() => setAdminLang("zh"));
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["new product", null],
    ["saved draft", { path: "/products/draft-slug", status: "DRAFT" as const }],
    ["saved disabled", { path: "/products/disabled-slug", status: "DISABLED" as const }],
  ])("does not request a public URL for %s", (_label, savedPreview) => {
    renderPanel(savedPreview);

    expect(screen.getByText("实时预览：当前未保存内容")).toBeInTheDocument();
    expect(screen.queryByTitle("桌面端商品页预览")).not.toBeInTheDocument();
    expect(screen.getByText(/不会请求或打开前台商品页/)).toBeInTheDocument();
  });

  it("uses the saved active path while marking current edits as unsaved", () => {
    renderPanel(
      { path: "/products/saved-slug", status: "ACTIVE" },
      "unsaved-slug",
      "DRAFT",
    );

    const desktopFrame = screen.getByTitle("桌面端商品页预览");
    expect(desktopFrame).toHaveAttribute("src", expect.stringContaining("/products/saved-slug"));
    expect(desktopFrame).not.toHaveAttribute("src", expect.stringContaining("unsaved-slug"));
    expect(screen.getByRole("link", { name: "打开已保存的前台页面" })).toHaveAttribute(
      "href",
      "/products/saved-slug",
    );
    expect(screen.getByText(/改动尚未保存/)).toBeInTheDocument();
    expect(screen.getByText(/已保存的上架页面仍然在线/)).toBeInTheDocument();
  });

  it("explains unsaved status changes even when the saved page is inactive", () => {
    renderPanel(
      { path: "/products/saved-draft", status: "DRAFT" },
      "saved-draft",
      "ACTIVE",
    );

    expect(screen.getByText(/改动尚未保存/)).toBeInTheDocument();
    expect(screen.getByText(/已保存版本目前未上架/)).toBeInTheDocument();
  });

  it("translates the preview state and iframe titles in English", () => {
    setAdminLang("en");
    renderPanel({ path: "/products/chair", status: "ACTIVE" }, "chair", "ACTIVE");

    expect(screen.getByText("Live preview: current unsaved content")).toBeInTheDocument();
    expect(screen.getAllByText("Desktop 1440×900")).toHaveLength(2);
    expect(screen.getAllByText("Mobile 390×844")).toHaveLength(2);
    expect(screen.getByTitle("Desktop product page preview")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open saved storefront page" })).toBeInTheDocument();
  });

  it.each([
    ["desktop", "电脑 1440×900", "1440px", "900px", "0.42", 360, "0.25", "225px"],
    ["mobile", "手机 390×844", "390px", "844px", "0.52", 195, "0.5", "422px"],
  ] as const)(
    "keeps the %s inner viewport fixed while scaling its outer frame",
    (device, label, viewportWidth, viewportHeight, initialScale, resizedWidth, resizedScale, resizedHeight) => {
      let resizeCallback: ResizeObserverCallback | undefined;
      class MockResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }

        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }

      vi.stubGlobal("ResizeObserver", MockResizeObserver);
      const { unmount } = render(
        <DeviceFrame device={device}>
          <p>Frame</p>
        </DeviceFrame>,
      );
      const frame = screen.getByText(label).nextElementSibling;
      const viewport = frame?.querySelector("[data-preview-viewport]");

      expect(viewport).toHaveStyle({
        width: viewportWidth,
        height: viewportHeight,
        transform: `scale(${initialScale})`,
      });
      expect(frame).toHaveStyle({ height: device === "desktop" ? "378px" : "438.88px" });

      act(() => {
        resizeCallback?.(
          [{ contentRect: { width: resizedWidth } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      expect(viewport).toHaveStyle({
        width: viewportWidth,
        height: viewportHeight,
        transform: `scale(${resizedScale})`,
      });
      expect(frame).toHaveStyle({ height: resizedHeight });

      unmount();
    },
  );

  it("keeps a device frame within its container width", () => {
    render(
      <DeviceFrame device="desktop">
        <p>Frame</p>
      </DeviceFrame>,
    );
    const frame = screen.getByText("电脑 1440×900").nextElementSibling;
    expect(frame).toHaveClass("w-full");
    expect(frame).toHaveStyle({ maxWidth: "604.8px" });
  });

  it("prefers the mobile frame on narrow screens via a responsive hide class on the desktop frame", () => {
    renderPanel(null);

    const desktopFrame = screen.getByText("桌面端 1440×900").closest("div");
    const mobileFrame = screen.getByText("移动端 390×844").closest("div");
    expect(desktopFrame?.className).toContain("max-[719px]:hidden");
    expect(mobileFrame?.className).not.toContain("max-[719px]:hidden");
  });
});
