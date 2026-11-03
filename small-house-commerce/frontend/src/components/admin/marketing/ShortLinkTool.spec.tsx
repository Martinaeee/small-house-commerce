import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { marketingApi } from "@/lib/marketing-api";
import { copyText } from "@/lib/clipboard";
import { ShortLinkTool } from "./ShortLinkTool";

vi.mock("@/lib/marketing-api", async (load) => ({
  ...(await load()),
  marketingApi: { createShortLink: vi.fn() },
}));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn() }));

const mount = () =>
  render(
    <AdminI18nProvider>
      <ShortLinkTool />
    </AdminI18nProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(marketingApi.createShortLink).mockResolvedValue({
    code: "abc12345",
    path: "/s/abc12345",
    target: "/products/chair?cl=code",
  });
  vi.mocked(copyText).mockResolvedValue(true);
});

describe("ShortLinkTool", () => {
  it("shortens a pasted storefront link and shows the absolute short URL", async () => {
    mount();

    fireEvent.change(screen.getByLabelText("站内链接"), {
      target: { value: "https://luwag.shop/products/chair?cl=code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成短链" }));

    await waitFor(() =>
      expect(marketingApi.createShortLink).toHaveBeenCalledWith({
        url: "https://luwag.shop/products/chair?cl=code",
      }),
    );
    expect(
      await screen.findByText("http://localhost:3000/s/abc12345"),
    ).toBeTruthy();
  });

  it("copies the full short URL", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("站内链接"), {
      target: { value: "/products/chair?cl=code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成短链" }));
    await screen.findByText("http://localhost:3000/s/abc12345");

    fireEvent.click(screen.getByRole("button", { name: "复制短链" }));

    await waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("http://localhost:3000/s/abc12345"),
    );
    expect(await screen.findByText("短链已复制。")).toBeTruthy();
  });

  it("explains a rejected link and keeps the input", async () => {
    vi.mocked(marketingApi.createShortLink).mockRejectedValue(
      new AdminApiError("Only luwag.shop links are supported.", 400),
    );
    mount();

    const input = screen.getByLabelText("站内链接");
    fireEvent.change(input, { target: { value: "https://evil.com/phish" } });
    fireEvent.click(screen.getByRole("button", { name: "生成短链" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "只支持 luwag.shop 站内链接。",
    );
    expect(input).toHaveValue("https://evil.com/phish");
  });

  it("reports an unexpected failure without claiming success", async () => {
    vi.mocked(marketingApi.createShortLink).mockRejectedValue(
      new AdminApiError("Internal error", 500),
    );
    mount();

    fireEvent.change(screen.getByLabelText("站内链接"), {
      target: { value: "/products/chair" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成短链" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "生成失败，请重试。",
    );
    expect(screen.queryByText(/\/s\//)).toBeNull();
  });
});
