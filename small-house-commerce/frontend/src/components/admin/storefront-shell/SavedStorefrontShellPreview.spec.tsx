import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin-auth";
import { DEFAULT_PUBLIC_STOREFRONT_SHELL } from "@/lib/storefront-shell";
import type {
  AdminShellPreviewResult,
  PublicStorefrontShell,
} from "@/lib/storefront-shell-api";
import { SavedStorefrontShellPreview } from "./SavedStorefrontShellPreview";

const apiMock = vi.hoisted(() => ({
  preview: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  status: "authed" as "loading" | "authed" | "guest",
}));

vi.mock("@/lib/storefront-shell-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/storefront-shell-api")>();
  return { ...actual, storefrontShellApi: apiMock };
});
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ status: authState.status }),
}));
vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/fonts", () => ({
  poppins: { variable: "--font-poppins", className: "font-poppins" },
}));

function previewResult(
  shell: PublicStorefrontShell = DEFAULT_PUBLIC_STOREFRONT_SHELL,
): AdminShellPreviewResult {
  return { version: 7, issues: [], shell };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.status = "authed";
  apiMock.preview.mockResolvedValue(previewResult());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SavedStorefrontShellPreview", () => {
  it("waits for auth hydration before requesting the saved draft", async () => {
    authState.status = "loading";
    const view = render(<SavedStorefrontShellPreview />);

    expect(screen.getByText("storefront_shell_loading")).toBeVisible();
    expect(apiMock.preview).not.toHaveBeenCalled();

    authState.status = "authed";
    view.rerender(<SavedStorefrontShellPreview />);
    await waitFor(() => expect(apiMock.preview).toHaveBeenCalledTimes(1));
  });

  it("renders the server-saved draft rather than any local state", async () => {
    apiMock.preview.mockResolvedValue(
      previewResult({
        ...structuredClone(DEFAULT_PUBLIC_STOREFRONT_SHELL),
        brand: {
          brandName: "Saved server brand",
          horizontalLogo: null,
          squareMark: null,
        },
        footer: {
          ...structuredClone(DEFAULT_PUBLIC_STOREFRONT_SHELL.footer),
          copyrightBrand: "Saved server brand",
        },
      }),
    );

    render(<SavedStorefrontShellPreview />);

    expect(
      await screen.findByLabelText("Saved server brand home"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Saved server brand/)).toBeVisible();
  });

  it("surfaces a retryable error when the preview request fails", async () => {
    apiMock.preview
      .mockRejectedValueOnce(new AdminApiError("forbidden", 403))
      .mockResolvedValueOnce(previewResult());

    render(<SavedStorefrontShellPreview />);

    const retry = await screen.findByRole("button", {
      name: "storefront_shell_retry",
    });
    fireEvent.click(retry);

    await waitFor(() => expect(apiMock.preview).toHaveBeenCalledTimes(2));
  });

  it("never accepts a query token or reusable draft credential", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<SavedStorefrontShellPreview />);

    await waitFor(() => expect(apiMock.preview).toHaveBeenCalledTimes(1));
    expect(apiMock.preview).toHaveBeenCalledWith();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
