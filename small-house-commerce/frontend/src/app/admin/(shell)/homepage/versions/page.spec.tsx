import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  emptyDocument,
  type HomepageDocument,
  type HomepageSection,
} from "@/lib/homepage-document";
import type { HomepageVersionMeta } from "@/lib/admin-api";
import HomepageVersionsPage from "./page";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  listHomepageVersions: vi.fn(),
  getHomepageVersion: vi.fn(),
  restoreHomepageVersion: vi.fn(),
  unpublishHomepageVersion: vi.fn(),
  publishHomepage: vi.fn(),
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ status: "authed", hasPermission: mocks.hasPermission }),
}));

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    listHomepageVersions: mocks.listHomepageVersions,
    getHomepageVersion: mocks.getHomepageVersion,
    restoreHomepageVersion: mocks.restoreHomepageVersion,
    unpublishHomepageVersion: mocks.unpublishHomepageVersion,
    publishHomepage: mocks.publishHomepage,
  },
}));

const HERO_ID = "00000000-0000-7000-8000-000000000001";
const SLIDE_ID = "00000000-0000-7000-8000-000000000010";
const USP_ID = "00000000-0000-7000-8000-000000000102";
const LIVE_ID = "00000000-0000-7000-8000-000000000201";
const SCHEDULED_ID = "00000000-0000-7000-8000-000000000202";
const ENDED_ID = "00000000-0000-7000-8000-000000000203";
const SUPERSEDED_ID = "00000000-0000-7000-8000-000000000204";

function versionMeta(
  overrides: Partial<HomepageVersionMeta> = {},
): HomepageVersionMeta {
  return {
    id: LIVE_ID,
    versionNo: 3,
    note: "Hero: 3 slides",
    createdById: "admin-42",
    createdAt: "2026-09-27T10:00:00.000Z",
    publishAt: "2026-09-27T10:00:00.000Z",
    unpublishAt: null,
    status: "LIVE",
    ...overrides,
  };
}

function versionDocument(): HomepageDocument {
  const doc = emptyDocument();
  const hero = doc.sections[0];
  if (hero.type !== "HERO") throw new Error("fixture expects a HERO section");
  hero.payload.slides[0].elements.heading.text = "Summer Sale";
  return doc;
}

function uspSection(): HomepageSection {
  return {
    id: USP_ID,
    type: "USP",
    title: "Why LUWAG",
    subtitle: "Built for small spaces",
    enabled: true,
    sortOrder: 10,
    schedule: {
      publishAt: "2026-09-20T00:00:00.000Z",
      unpublishAt: null,
    },
    products: [],
    payload: {},
  };
}

function fourRows(): HomepageVersionMeta[] {
  return [
    versionMeta(),
    versionMeta({
      id: SCHEDULED_ID,
      versionNo: 4,
      status: "SCHEDULED",
      createdById: "admin-7",
      note: "Autumn campaign",
      publishAt: "2026-10-01T09:30:00.000Z",
    }),
    versionMeta({
      id: ENDED_ID,
      versionNo: 2,
      status: "ENDED",
      note: null,
      createdById: null,
      unpublishAt: "2026-09-27T09:00:00.000Z",
    }),
    versionMeta({
      id: SUPERSEDED_ID,
      versionNo: 1,
      status: "SUPERSEDED",
      createdById: "admin-1",
      note: "First publish",
    }),
  ];
}

function renderPage() {
  return render(
    <AdminI18nProvider>
      <HomepageVersionsPage />
    </AdminI18nProvider>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("HomepageVersionsPage", () => {
  beforeEach(() => {
    setAdminLang("en");
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.hasPermission.mockReturnValue(true);
    mocks.listHomepageVersions.mockResolvedValue(fourRows());
    mocks.getHomepageVersion.mockResolvedValue({
      ...versionMeta(),
      document: versionDocument(),
    });
    mocks.restoreHomepageVersion.mockResolvedValue({ draftRev: 9 });
    mocks.unpublishHomepageVersion.mockResolvedValue(undefined);
  });

  it("lists versions with status badges and offers unpublish only for LIVE/SCHEDULED", async () => {
    renderPage();
    await flush();

    expect(screen.getByText("Version 3")).toBeVisible();
    expect(screen.getByText("Version 4")).toBeVisible();
    expect(screen.getByText("admin-42")).toBeVisible();
    expect(screen.getByText("admin-7")).toBeVisible();
    expect(screen.getByText("Hero: 3 slides")).toBeVisible();

    expect(screen.getByText("Live")).toBeVisible();
    expect(screen.getByText("Scheduled")).toBeVisible();
    expect(screen.getByText("Ended")).toBeVisible();
    expect(screen.getByText("Superseded")).toBeVisible();

    expect(
      screen.getAllByRole("button", { name: "Unpublish" }),
    ).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Restore to draft" })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Preview" })).toHaveLength(4);
  });

  it("restores a version into the draft without publishing and links back to the editor", async () => {
    renderPage();
    await flush();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Restore to draft" })[0],
    );
    const dialog = screen.getByRole("dialog", { name: "Restore to draft" });
    expect(dialog).toBeVisible();
    expect(
      screen.getByText(
        "Restore this version into the draft? It goes live only after publishing.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await flush();

    expect(mocks.restoreHomepageVersion).toHaveBeenCalledWith(LIVE_ID);
    expect(mocks.publishHomepage).not.toHaveBeenCalled();
    expect(
      screen.getByText("Restored to the draft; it takes effect after publishing."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open the editor to review the draft" }),
    ).toHaveAttribute("href", "/admin/homepage");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("unpublishes a LIVE version after confirmation and refreshes the list", async () => {
    renderPage();
    await flush();
    expect(mocks.listHomepageVersions).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Unpublish" })[0]);
    expect(
      screen.getByRole("dialog", { name: "Unpublish" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Take this version offline? The storefront will stop serving it.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await flush();

    expect(mocks.unpublishHomepageVersion).toHaveBeenCalledWith(LIVE_ID);
    expect(mocks.listHomepageVersions).toHaveBeenCalledTimes(2);
  });

  it("keeps the unpublish dialog open with a readable error when the call fails", async () => {
    mocks.unpublishHomepageVersion.mockRejectedValue(
      new Error("Version is already offline"),
    );
    renderPage();
    await flush();

    fireEvent.click(screen.getAllByRole("button", { name: "Unpublish" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await flush();

    expect(
      screen.getByText("Action failed: Version is already offline"),
    ).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Unpublish" })).toBeVisible();
    expect(mocks.listHomepageVersions).toHaveBeenCalledTimes(1);
  });

  it("previews a version read-only with the hero and summary rows for other sections", async () => {
    const doc = versionDocument();
    doc.sections.push(uspSection());
    mocks.getHomepageVersion.mockResolvedValue({
      ...versionMeta(),
      document: doc,
    });
    renderPage();
    await flush();

    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);
    await flush();

    expect(mocks.getHomepageVersion).toHaveBeenCalledWith(LIVE_ID);
    const dialog = screen.getByRole("dialog", {
      name: "Version preview (read-only)",
    });
    expect(dialog).toBeVisible();

    // Hero renders through the read-only HeroSlider (no edit affordances).
    expect(screen.getByText("Summer Sale")).toBeVisible();
    expect(dialog.querySelector(`#hp-hero-${HERO_ID}`)).not.toBeNull();
    expect(dialog.querySelector(`[data-slide="${SLIDE_ID}"]`)).not.toBeNull();
    expect(dialog.querySelector("[data-hero-selection-box]")).toBeNull();
    expect(dialog.querySelector("[data-hero-handle]")).toBeNull();

    // Other section types are read-only summary rows, clearly labelled.
    const summary = dialog.querySelector(`[data-version-summary="${USP_ID}"]`);
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("USP");
    expect(summary).toHaveTextContent("Why LUWAG");
    expect(summary).toHaveTextContent("Built for small spaces");
    expect(summary).toHaveTextContent("Enabled");
    expect(summary).toHaveTextContent("summary only");

    expect(
      screen.getByText(
        "Read-only snapshot: P1 fully renders only the hero and the announcement bar; other sections are listed as summaries.",
      ),
    ).toBeVisible();
  });

  it("renders a readable error state for a malformed version document", async () => {
    mocks.getHomepageVersion.mockResolvedValue({
      ...versionMeta(),
      document: { schemaVersion: 1, sections: "nope", announcement: {} },
    });
    renderPage();
    await flush();

    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);
    await flush();

    expect(
      screen.getByText(
        "This version's document has an unexpected shape and cannot be previewed.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Summer Sale")).not.toBeInTheDocument();
  });

  it("shows the permission message instead of a load error without PRODUCT_MANAGE", async () => {
    mocks.hasPermission.mockReturnValue(false);
    renderPage();
    await flush();

    expect(
      screen.getByText("Your account cannot access the homepage builder."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "PRODUCT_MANAGE permission is required — ask a super admin to grant it.",
      ),
    ).toBeVisible();
    expect(mocks.listHomepageVersions).not.toHaveBeenCalled();
  });

  it("shows a readable load error and retries", async () => {
    mocks.listHomepageVersions
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(fourRows());
    renderPage();
    await flush();

    expect(screen.getByText("Failed to load the version list.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flush();

    expect(mocks.listHomepageVersions).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Version 3")).toBeVisible();
  });
});
