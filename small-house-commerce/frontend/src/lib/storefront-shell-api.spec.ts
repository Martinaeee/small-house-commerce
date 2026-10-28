import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCurrentLuwagShellDocument } from "./storefront-shell-document";
import {
  parseAdminShellSnapshot,
  parseAdminShellValidationResult,
  parsePublicStorefrontShell,
  storefrontShellApi,
} from "./storefront-shell-api";

const authMock = vi.hoisted(() => ({
  fetch: vi.fn(),
  once: vi.fn(),
}));

vi.mock("./admin-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./admin-auth")>();
  return {
    ...actual,
    adminAuthedFetch: authMock.fetch,
    adminAuthedFetchOnce: authMock.once,
  };
});

const document = createCurrentLuwagShellDocument({
  rootCategories: [],
  navigationCollections: [],
  supportEmail: "support@luwag.ph",
  supportHours: "Mon–Sat, 9am–6pm (PHT)",
});

const derivedTheme = {
  primaryDark: "#b8946a",
  primaryLight: "#e8dccb",
  actionHover: "#5a4130",
  textSecondary: "#666666",
  textMuted: "#999999",
  border: "#e8e2d9",
  focus: "#6b4f3a",
  disabled: "#999999",
  actionForeground: "#ffffff",
};

const asset = {
  id: "10000000-0000-7000-8000-000000000901",
  kind: "HORIZONTAL",
  url: "/uploads/brand/2026/logo.webp",
  mimeType: "image/webp",
  width: 600,
  height: 120,
  durable: true,
  createdAt: "2026-10-13T04:00:00.000Z",
};

const snapshot = {
  document,
  version: 7,
  publishedRevision: 4,
  hasUnpublishedChanges: true,
  updatedAt: "2026-10-13T04:00:00.000Z",
  publishedAt: "2026-10-13T03:00:00.000Z",
  issues: [],
  assets: { [asset.id]: asset },
};

const publicShell = {
  publishedRevision: 4,
  brand: { brandName: "LUWAG", horizontalLogo: null, squareMark: null },
  header: {
    items: [
      { id: "home", kind: "LINK", label: "Home", href: "/" },
    ],
  },
  footer: {
    tagline: document.footer.tagline,
    description: document.footer.description,
    columns: [
      {
        id: "contact",
        kind: "CONTACT",
        title: "Contact",
        supportEmail: "support@luwag.ph",
        supportHours: "Mon–Sat, 9am–6pm (PHT)",
        trackOrderLabel: "Track Order",
        trackOrderHref: "/track-order",
      },
    ],
    copyrightBrand: document.footer.copyrightBrand,
    socials: [],
    legal: [],
    payments: [],
  },
  theme: document.theme,
  derivedTheme,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("storefrontShellApi transport", () => {
  it("gets and strictly parses the admin draft", async () => {
    authMock.fetch.mockResolvedValue(snapshot);

    await expect(storefrontShellApi.get()).resolves.toEqual(snapshot);

    expect(authMock.fetch).toHaveBeenCalledWith(
      "/api/v1/admin/storefront-shell",
    );
  });

  it("saves the document with the exact expectedVersion JSON body", async () => {
    authMock.fetch.mockResolvedValue(snapshot);

    await storefrontShellApi.save(document, 7);

    expect(authMock.fetch).toHaveBeenCalledWith(
      "/api/v1/admin/storefront-shell",
      {
        method: "PATCH",
        body: JSON.stringify({ document, expectedVersion: 7 }),
      },
    );
  });

  it("validates unsaved input and parses version, issues and derived theme", async () => {
    authMock.fetch.mockResolvedValue({ version: 7, issues: [], derivedTheme });

    await expect(storefrontShellApi.validate(document)).resolves.toEqual({
      version: 7,
      issues: [],
      derivedTheme,
    });

    expect(authMock.fetch).toHaveBeenCalledWith(
      "/api/v1/admin/storefront-shell/validate",
      { method: "POST", body: JSON.stringify(document) },
    );
  });

  it("publishes exactly once through the non-replaying auth helper", async () => {
    authMock.once.mockResolvedValue(snapshot);

    await storefrontShellApi.publish(7);

    expect(authMock.once).toHaveBeenCalledTimes(1);
    expect(authMock.once).toHaveBeenCalledWith(
      "/api/v1/admin/storefront-shell/publish",
      { method: "POST", body: JSON.stringify({ expectedVersion: 7 }) },
    );
    expect(authMock.fetch).not.toHaveBeenCalled();
  });

  it("uploads raw image bytes with an encoded slot and no replay", async () => {
    authMock.once.mockResolvedValue({ version: 7, issues: [], asset });
    const file = new File(["png-bytes"], "logo.png", { type: "image/png" });

    await expect(storefrontShellApi.upload(file, "square")).resolves.toEqual({
      version: 7,
      issues: [],
      asset,
    });

    expect(authMock.once).toHaveBeenCalledTimes(1);
    expect(authMock.once).toHaveBeenCalledWith(
      "/api/v1/admin/storefront-shell/upload?slot=square",
      {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: file,
      },
    );
  });

  it("loads and parses the authenticated saved-draft preview", async () => {
    authMock.fetch.mockResolvedValue({ version: 7, issues: [], shell: publicShell });

    await expect(storefrontShellApi.preview()).resolves.toEqual({
      version: 7,
      issues: [],
      shell: publicShell,
    });

    expect(authMock.fetch).toHaveBeenCalledWith(
      "/api/v1/admin/storefront-shell/preview",
    );
  });
});

describe("storefront shell exact response schemas", () => {
  it("rejects every admin payload missing version or issues", () => {
    expect(() => parseAdminShellSnapshot({ ...snapshot, version: undefined })).toThrow(
      /version/,
    );
    expect(() => parseAdminShellSnapshot({ ...snapshot, issues: undefined })).toThrow(
      /issues/,
    );
  });

  it("rejects unknown admin fields and forged asset storage metadata", () => {
    expect(() => parseAdminShellSnapshot({ ...snapshot, unexpected: true })).toThrow(
      /unexpected/,
    );
    expect(() =>
      parseAdminShellSnapshot({
        ...snapshot,
        assets: {
          [asset.id]: { ...asset, storageKey: "attacker-controlled" },
        },
      }),
    ).toThrow(/storageKey/);
  });

  it("preserves stable issue jump targets and contrast evidence", () => {
    const issue = {
      code: "THEME_ACTION_CONTRAST",
      path: ["theme", "action"],
      message: "Contrast is too low",
      itemId: "action",
      ratio: 3.2,
      requiredRatio: 4.5,
    };
    expect(
      parseAdminShellValidationResult({
        version: 7,
        issues: [issue],
        derivedTheme,
      }).issues,
    ).toEqual([issue]);
  });

  it("keeps Contact content when an unavailable Track Order target is projected as null", () => {
    const contactWithoutTrackTarget = {
      ...publicShell,
      footer: {
        ...publicShell.footer,
        columns: publicShell.footer.columns.map((column) =>
          column.kind === "CONTACT"
            ? { ...column, trackOrderHref: null }
            : column,
        ),
      },
    };

    expect(
      parsePublicStorefrontShell(contactWithoutTrackTarget).footer.columns[0],
    ).toMatchObject({
      kind: "CONTACT",
      supportEmail: "support@luwag.ph",
      trackOrderHref: null,
    });
  });

  it("parses a public Contact column that no longer carries the COD note", () => {
    expect(
      parsePublicStorefrontShell(publicShell).footer.columns[0],
    ).not.toHaveProperty("codText");
  });

  it("parses the exact public projection and rejects draft/audit leakage", () => {
    expect(parsePublicStorefrontShell(publicShell)).toEqual(publicShell);
    expect(() =>
      parsePublicStorefrontShell({ ...publicShell, draftDocument: document }),
    ).toThrow(/draftDocument/);
    expect(() =>
      parsePublicStorefrontShell({ ...publicShell, publishedByUserId: "user" }),
    ).toThrow(/publishedByUserId/);
  });
});
