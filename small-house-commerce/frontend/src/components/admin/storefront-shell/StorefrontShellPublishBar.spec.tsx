import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorefrontShellPublishBar } from "./StorefrontShellPublishBar";

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    lang: "en",
    setLang: vi.fn(),
    t: (key: string) => key,
  }),
}));

const callbacks = {
  onSave: vi.fn(),
  onPublish: vi.fn(),
  onReload: vi.fn(),
  onRetry: vi.fn(),
  onRestoreDefaults: vi.fn(),
};

function renderBar(
  props: Partial<Parameters<typeof StorefrontShellPublishBar>[0]> = {},
) {
  return render(
    <StorefrontShellPublishBar
      version={7}
      unsaved={false}
      hasUnpublishedChanges={false}
      pendingUploads={new Set()}
      saving={false}
      validating={false}
      publishing={false}
      publishedRevision={3}
      publishedAt="2026-10-13T03:00:00.000Z"
      updatedAt="2026-10-13T04:00:00.000Z"
      conflict={null}
      failure={null}
      {...callbacks}
      {...props}
    />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("StorefrontShellPublishBar", () => {
  it("shows local unsaved state, enables save and blocks publish", () => {
    renderBar({ unsaved: true });

    expect(screen.getByText("storefront_shell_status_unsaved")).toBeVisible();
    expect(screen.getByRole("button", { name: "storefront_shell_save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "storefront_shell_publish" })).toBeDisabled();
  });

  it("blocks save and publish while either brand asset is uploading", () => {
    renderBar({
      unsaved: true,
      pendingUploads: new Set(["horizontal"]),
    });

    expect(screen.getByText("storefront_shell_status_uploading")).toBeVisible();
    expect(screen.getByRole("button", { name: "storefront_shell_save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "storefront_shell_publish" })).toBeDisabled();
  });

  it("distinguishes validating, saved draft and pending publish states", () => {
    const { rerender } = renderBar({ validating: true, unsaved: true });
    expect(screen.getByText("storefront_shell_status_validating")).toBeVisible();

    rerender(
      <StorefrontShellPublishBar
        version={7}
        unsaved={false}
        hasUnpublishedChanges
        pendingUploads={new Set()}
        saving={false}
        validating={false}
        publishing={false}
        publishedRevision={3}
        publishedAt="2026-10-13T03:00:00.000Z"
        updatedAt="2026-10-13T04:00:00.000Z"
        conflict={null}
        failure={null}
        {...callbacks}
      />,
    );
    expect(screen.getByText("storefront_shell_status_pending_publish")).toBeVisible();
    expect(screen.getByRole("button", { name: "storefront_shell_publish" })).toBeEnabled();
  });

  it("confirms restore-defaults in an in-page dialog before touching the draft", () => {
    renderBar();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "storefront_shell_restore_defaults",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("storefront_shell_restore_dialog_title"),
    ).toBeVisible();
    expect(
      within(dialog).getByText("storefront_shell_restore_dialog_body"),
    ).toBeVisible();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "storefront_shell_restore_dialog_cancel",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callbacks.onRestoreDefaults).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "storefront_shell_restore_defaults",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "storefront_shell_restore_dialog_confirm",
      }),
    );
    expect(callbacks.onRestoreDefaults).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("summarizes published revision, draft version and the last save", () => {
    renderBar({
      publishedRevision: 4,
      publishedAt: "2026-10-13T03:00:00.000Z",
      updatedAt: "2026-10-13T04:00:00.000Z",
    });

    expect(screen.getByTestId("shell-published-revision")).toHaveTextContent(
      "storefront_shell_published_revision",
    );
    expect(screen.getByTestId("shell-version")).toHaveTextContent(
      "storefront_shell_version",
    );
    expect(screen.getByTestId("shell-last-saved")).toHaveTextContent(
      "storefront_shell_last_saved",
    );
  });

  it("marks a never-published shell instead of a published revision", () => {
    renderBar({ publishedRevision: 0, publishedAt: null });

    expect(screen.getByTestId("shell-published-revision")).toHaveTextContent(
      "storefront_shell_never_published",
    );
  });

  it("exposes conflict reload and retryable operation failures", () => {
    renderBar({
      conflict: { currentVersion: 9 },
      failure: { operation: "save", message: "offline" },
    });

    expect(screen.getByText("storefront_shell_conflict")).toBeVisible();
    expect(screen.getByText("offline")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "storefront_shell_reload" }));
    fireEvent.click(screen.getByRole("button", { name: "storefront_shell_retry" }));
    expect(callbacks.onReload).toHaveBeenCalledTimes(1);
    expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
  });
});
