import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin-auth";
import {
  createCurrentLuwagShellDocument,
  type StorefrontShellDocument,
} from "@/lib/storefront-shell-document";
import { deriveStorefrontTheme } from "@/lib/storefront-theme";
import type {
  AdminShellSnapshot,
  AdminShellUploadResult,
  AdminShellValidationResult,
} from "@/lib/storefront-shell-api";
import {
  StorefrontShellEditor,
  useStorefrontShellEditor,
} from "./StorefrontShellEditor";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  validate: vi.fn(),
  publish: vi.fn(),
  upload: vi.fn(),
  preview: vi.fn(),
}));

const adminApiMock = vi.hoisted(() => ({
  listCategories: vi.fn(),
  listCollections: vi.fn(),
  listProducts: vi.fn(),
  listLandingPages: vi.fn(),
  getProduct: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  status: "authed" as "loading" | "authed" | "guest",
  admin: {
    id: "actor-a",
    name: "Actor A",
    email: "a@example.com",
    status: "ACTIVE",
    roles: [],
    permissions: ["STOREFRONT_SHELL_MANAGE"],
  } as {
    id: string;
    name: string;
    email: string;
    status: string;
    roles: never[];
    permissions: string[];
  } | null,
  permissions: ["STOREFRONT_SHELL_MANAGE"] as string[],
}));

const navigationState = vi.hoisted(() => ({ tab: null as string | null }));
const i18nState = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));

vi.mock("@/lib/storefront-shell-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storefront-shell-api")>();
  return { ...actual, storefrontShellApi: apiMock };
});

vi.mock("@/lib/admin-api", () => ({ adminApi: adminApiMock }));
vi.mock("@/lib/fonts", () => ({
  poppins: { variable: "--font-poppins", className: "font-poppins" },
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    status: authState.status,
    admin: authState.admin,
    hasPermission: (permission: string) =>
      authState.permissions.includes(permission),
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      navigationState.tab === null ? "" : `tab=${navigationState.tab}`,
    ),
}));

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    lang: i18nState.lang,
    setLang: vi.fn(),
    t: (key: string, params?: Record<string, unknown>) => {
      const template =
        key === "storefront_shell_brand_asset_meta"
          ? "{width}×{height} · {mime}"
          : key;
      return params
        ? template.replace(/\{(\w+)\}/g, (_, name: string) =>
            String(params[name] ?? ""),
          )
        : template;
    },
  }),
}));

const HORIZONTAL_ASSET_ID = "00000000-0000-7000-8000-000000000901";

function documentFor(brandName: string): StorefrontShellDocument {
  const document = createCurrentLuwagShellDocument({
    rootCategories: [
      {
        id: "00000000-0000-7000-8000-000000000101",
        name: "Living Room",
        sortOrder: 10,
      },
    ],
    navigationCollections: [
      {
        id: "00000000-0000-7000-8000-000000000201",
        name: "New Arrivals",
        slug: "new-arrivals",
        sortOrder: 0,
      },
      {
        id: "00000000-0000-7000-8000-000000000203",
        name: "Best Sellers",
        slug: "best-sellers",
        sortOrder: 60,
      },
    ],
    supportEmail: "support@luwag.ph",
    supportHours: "Mon–Sat, 9am–6pm (PHT)",
  });
  return {
    ...document,
    brand: {
      ...document.brand,
      brandName,
      horizontalLogo: { assetId: HORIZONTAL_ASSET_ID },
    },
  };
}

function snapshot(
  brandName = "Actor A shell",
  version = 7,
  hasUnpublishedChanges = false,
): AdminShellSnapshot {
  const document = documentFor(brandName);
  return {
    document,
    version,
    publishedRevision: 3,
    hasUnpublishedChanges,
    updatedAt: "2026-10-13T04:00:00.000Z",
    publishedAt: "2026-10-13T03:00:00.000Z",
    issues: [],
    assets: {
      [HORIZONTAL_ASSET_ID]: {
        id: HORIZONTAL_ASSET_ID,
        kind: "HORIZONTAL",
        url: "/uploads/brand/logo.webp",
        mimeType: "image/webp",
        width: 600,
        height: 120,
        durable: true,
        createdAt: "2026-10-13T02:00:00.000Z",
      },
    },
  };
}

function validation(
  document: StorefrontShellDocument,
  version = 7,
): AdminShellValidationResult {
  return {
    version,
    issues: [],
    derivedTheme: deriveStorefrontTheme(document.theme),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function EditorProbe() {
  const editor = useStorefrontShellEditor();
  return (
    <div data-testid="editor-probe">
      <output data-testid="probe-document">
        {JSON.stringify(editor.document)}
      </output>
      <output data-testid="probe-tab">{editor.state.tab}</output>
      <output data-testid="probe-pending">
        {[...editor.state.pendingUploads].join(",")}
      </output>
      <button
        type="button"
        onClick={() =>
          editor.updateDocument((document) => ({
            ...document,
            brand: { ...document.brand, brandName: "Probe edit" },
          }))
        }
      >
        Probe edit
      </button>
      <button type="button" onClick={() => void editor.validate()}>
        Probe validate
      </button>
      <button
        type="button"
        onClick={() =>
          void editor.upload(
            new File(["png"], "logo.png", { type: "image/png" }),
            "horizontal",
          )
        }
      >
        Probe upload
      </button>
    </div>
  );
}

function renderEditor() {
  return render(
    <StorefrontShellEditor>
      <EditorProbe />
    </StorefrontShellEditor>,
  );
}

async function readyEditor(brandName = "Actor A shell") {
  apiMock.get.mockResolvedValueOnce(snapshot(brandName));
  const view = renderEditor();
  // The publish bar only renders once the draft is loaded, and unlike the
  // brand-name field it is visible on every tab.
  await screen.findByTestId("storefront-shell-publish-bar");
  return view;
}

beforeEach(() => {
  vi.useRealTimers();
  // resetAllMocks, not clearAllMocks: clear leaves unconsumed *Once queues in
  // place, so one test's queued resolution can be consumed by the next.
  vi.resetAllMocks();
  navigationState.tab = null;
  i18nState.lang = "en";
  authState.status = "authed";
  authState.permissions = ["STOREFRONT_SHELL_MANAGE"];
  authState.admin = {
    id: "actor-a",
    name: "Actor A",
    email: "a@example.com",
    status: "ACTIVE",
    roles: [],
    permissions: ["STOREFRONT_SHELL_MANAGE"],
  };
  apiMock.validate.mockImplementation(
    async (document: StorefrontShellDocument) => validation(document),
  );
  adminApiMock.listCategories.mockResolvedValue([]);
  adminApiMock.listCollections.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  apiMock.save.mockImplementation(
    async (document: StorefrontShellDocument, version: number) => ({
      ...snapshot(document.brand.brandName, version + 1, true),
      document,
    }),
  );
  apiMock.publish.mockImplementation(async (version: number) =>
    snapshot("Actor A shell", version + 1, false),
  );
  apiMock.upload.mockResolvedValue({
    version: 7,
    issues: [],
    asset: snapshot().assets[HORIZONTAL_ASSET_ID],
  } satisfies AdminShellUploadResult);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("StorefrontShellEditor loading and selection", () => {
  it("renders loading, a retryable load error, then the loaded draft", async () => {
    apiMock.get
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(snapshot());

    renderEditor();
    expect(screen.getByText("storefront_shell_loading")).toBeVisible();
    expect(await screen.findByText("storefront_shell_load_error")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_retry" }),
    );

    expect(await screen.findByDisplayValue("Actor A shell")).toBeVisible();
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["brand", "shell-brand-panel"],
    ["header", "shell-header-panel"],
    ["footer", "shell-footer-panel"],
    ["bogus", "shell-brand-panel"],
    [null, "shell-brand-panel"],
  ])("selects tab %s without changing the document", async (tab, panel) => {
    navigationState.tab = tab;
    await readyEditor();

    expect(screen.getByTestId(panel!)).toBeVisible();
    expect(JSON.parse(screen.getByTestId("probe-document").textContent!)).toEqual(
      documentFor("Actor A shell"),
    );
  });

  it("keeps brand, header and footer fields in separate tab panels", async () => {
    const user = userEvent.setup();
    await readyEditor();

    expect(screen.getByTestId("shell-brand-panel")).toBeVisible();
    expect(screen.queryByTestId("shell-header-panel")).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "storefront_shell_brand_name" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "storefront_shell_tab_header" }),
    );
    expect(screen.getByTestId("shell-header-panel")).toBeVisible();
    expect(screen.queryByTestId("shell-brand-panel")).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "storefront_shell_brand_name" }),
    ).toBeNull();
  });

  it("preserves local input across tab, device and language changes", async () => {
    const user = userEvent.setup();
    const view = await readyEditor();
    const input = screen.getByRole("textbox", {
      name: "storefront_shell_brand_name",
    });
    await user.clear(input);
    await user.type(input, "Local brand");
    expect(screen.getByText("storefront_shell_status_unsaved")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "storefront_shell_tab_footer" }),
    );
    await user.click(
      screen.getByRole("button", { name: "storefront_shell_device_mobile" }),
    );
    i18nState.lang = "zh";
    view.rerender(
      <StorefrontShellEditor>
        <EditorProbe />
      </StorefrontShellEditor>,
    );

    expect(screen.getByTestId("shell-footer-panel")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "storefront_shell_device_mobile" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(screen.getByTestId("probe-document").textContent!).brand.brandName).toBe(
      "Local brand",
    );
  });
});

describe("StorefrontShellEditor save and publish lifecycle", () => {
  it("joins same-tick saves, sends the loaded version and adopts the response version", async () => {
    const save = deferred<AdminShellSnapshot>();
    apiMock.save.mockReturnValue(save.promise);
    const user = userEvent.setup();
    await readyEditor();
    const input = screen.getByRole("textbox", {
      name: "storefront_shell_brand_name",
    });
    await user.clear(input);
    await user.type(input, "Saved once");

    const button = screen.getByRole("button", { name: "storefront_shell_save" });
    act(() => {
      button.click();
      button.click();
    });

    expect(apiMock.save).toHaveBeenCalledTimes(1);
    expect(apiMock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: expect.objectContaining({ brandName: "Saved once" }),
      }),
      7,
    );
    const sentDocument = apiMock.save.mock.calls[0][0] as StorefrontShellDocument;
    save.resolve({ ...snapshot("Saved once", 8, true), document: sentDocument });

    await waitFor(() =>
      expect(screen.getByText("storefront_shell_status_pending_publish")).toBeVisible(),
    );
    expect(screen.getByTestId("shell-version")).toHaveTextContent("8");
    expect(screen.getByRole("button", { name: "storefront_shell_save" })).toBeDisabled();
  });

  it("publishes the exact saved version and trusts only each server response", async () => {
    apiMock.get.mockResolvedValueOnce(snapshot("Saved draft", 7, true));
    apiMock.publish
      .mockResolvedValueOnce(snapshot("Saved draft", 8, true))
      .mockResolvedValueOnce(snapshot("Saved draft", 9, false));
    renderEditor();
    await screen.findByDisplayValue("Saved draft");

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_publish" }),
    );
    await waitFor(() => expect(apiMock.publish).toHaveBeenCalledWith(7));
    expect(screen.getByText("storefront_shell_status_pending_publish")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_publish" }),
    );
    await waitFor(() => expect(apiMock.publish).toHaveBeenLastCalledWith(8));
    expect(screen.getByText("storefront_shell_status_published")).toBeVisible();
  });

  it("preserves the full local document and tab across save, validate and upload failures", async () => {
    navigationState.tab = "footer";
    apiMock.save.mockRejectedValue(new Error("save offline"));
    apiMock.validate.mockRejectedValue(new Error("validation offline"));
    apiMock.upload.mockRejectedValue(new Error("upload offline"));
    await readyEditor();
    fireEvent.click(screen.getByRole("button", { name: "Probe edit" }));
    const expected = screen.getByTestId("probe-document").textContent;

    fireEvent.click(screen.getByRole("button", { name: "storefront_shell_save" }));
    expect(await screen.findByText("save offline")).toBeVisible();
    expect(screen.getByTestId("probe-document")).toHaveTextContent(expected!);
    expect(screen.getByTestId("probe-tab")).toHaveTextContent("footer");

    fireEvent.click(screen.getByRole("button", { name: "Probe validate" }));
    expect(await screen.findByText("validation offline")).toBeVisible();
    expect(screen.getByTestId("probe-document")).toHaveTextContent(expected!);

    fireEvent.click(screen.getByRole("button", { name: "Probe upload" }));
    expect(await screen.findByText("upload offline")).toBeVisible();
    expect(screen.getByTestId("probe-document")).toHaveTextContent(expected!);
    const parsed = JSON.parse(screen.getByTestId("probe-document").textContent!);
    expect(parsed.header.items.map((item: { id: string }) => item.id)).toEqual(
      documentFor("Probe edit").header.items.map((item) => item.id),
    );
    expect(parsed.brand.horizontalLogo).toEqual({ assetId: HORIZONTAL_ASSET_ID });
  });

  it("preserves the saved draft and selected tab when publish fails", async () => {
    navigationState.tab = "footer";
    apiMock.get.mockResolvedValueOnce(snapshot("Pending publish", 7, true));
    apiMock.publish.mockRejectedValueOnce(new Error("publish offline"));
    renderEditor();
    await screen.findByTestId("storefront-shell-publish-bar");
    const expected = screen.getByTestId("probe-document").textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_publish" }),
    );

    expect(await screen.findByText("publish offline")).toBeVisible();
    expect(screen.getByTestId("probe-document")).toHaveTextContent(expected!);
    expect(screen.getByTestId("probe-tab")).toHaveTextContent("footer");
  });

  it("preserves local edits on 409 and exposes an explicit reload", async () => {
    apiMock.save.mockRejectedValueOnce(
      new AdminApiError(
        "changed elsewhere",
        409,
        undefined,
        { code: "SHELL_VERSION_MISMATCH", currentVersion: 12 },
      ),
    );
    apiMock.get
      .mockResolvedValueOnce(snapshot("Local base"))
      .mockResolvedValueOnce(snapshot("Latest server", 12, true));
    renderEditor();
    const input = await screen.findByDisplayValue("Local base");
    fireEvent.change(input, { target: { value: "Keep local" } });
    fireEvent.click(screen.getByRole("button", { name: "storefront_shell_save" }));

    expect(await screen.findByText("storefront_shell_conflict")).toBeVisible();
    expect(screen.getByDisplayValue("Keep local")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "storefront_shell_reload" }));
    expect(await screen.findByDisplayValue("Latest server")).toBeVisible();
  });

  it("warns before leaving only while local input is unsaved", async () => {
    await readyEditor();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(
      screen.getByRole("textbox", { name: "storefront_shell_brand_name" }),
      { target: { value: "Unsaved" } },
    );
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("StorefrontShellEditor brand upload integration", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: vi.fn(() => "blob:brand-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true, value: vi.fn(),
    });
  });

  it("registers uploaded metadata and selects the asset only in the local draft", async () => {
    const newAsset = {
      ...snapshot().assets[HORIZONTAL_ASSET_ID],
      id: "00000000-0000-7000-8000-000000000902",
      url: "/uploads/brand/replacement.webp",
      width: 1200, height: 240,
    };
    apiMock.upload.mockResolvedValueOnce({ version: 7, issues: [], asset: newAsset });
    await readyEditor();
    fireEvent.change(screen.getByLabelText("storefront_shell_brand_horizontal"), {
      target: { files: [new File(["png"], "logo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(JSON.parse(screen.getByTestId("probe-document").textContent!).brand.horizontalLogo)
      .toEqual({ assetId: newAsset.id }));
    expect(screen.getByText("1200×240 · image/webp")).toBeVisible();
    expect(screen.getByRole("button", { name: "storefront_shell_publish" })).toBeDisabled();
    expect(apiMock.save).not.toHaveBeenCalled();
  });

  it("locks defaults, both asset removals and structural edits until the upload settles", async () => {
    const pending = deferred<AdminShellUploadResult>();
    apiMock.upload.mockReturnValueOnce(pending.promise);
    await readyEditor();
    fireEvent.change(screen.getByLabelText("storefront_shell_brand_horizontal"), {
      target: { files: [new File(["png"], "logo.png", { type: "image/png" })] },
    });
    expect(screen.getByRole("button", { name: "storefront_shell_restore_defaults" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "storefront_shell_brand_remove" })).toBeDisabled();
    expect(screen.getByLabelText("storefront_shell_brand_square")).toBeDisabled();
    // Structural edits live in the header tab and lock under the same upload.
    fireEvent.click(screen.getByRole("button", { name: "storefront_shell_tab_header" }));
    const deletes = screen.getAllByRole("button", { name: "storefront_shell_delete" });
    expect(deletes.length).toBeGreaterThan(0);
    for (const button of deletes) expect(button).toBeDisabled();
    pending.resolve({ version: 7, issues: [], asset: snapshot().assets[HORIZONTAL_ASSET_ID] });
    await act(async () => pending.promise);
    await waitFor(() => {
      for (const button of screen.getAllByRole("button", { name: "storefront_shell_delete" })) {
        expect(button).toBeEnabled();
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "storefront_shell_tab_brand" }));
    expect(screen.getByLabelText("storefront_shell_brand_square")).toBeEnabled();
  });

  it("clears a stale validation lock but does not apply issues after the document changes", async () => {
    const pending = deferred<AdminShellValidationResult>();
    apiMock.validate.mockReturnValueOnce(pending.promise);
    await readyEditor();
    fireEvent.click(screen.getByRole("button", { name: "Probe validate" }));
    fireEvent.click(screen.getByRole("button", { name: "Probe edit" }));
    pending.resolve({ ...validation(documentFor("old")), issues: [{ code: "OLD", path: [], message: "Old issue" }] });
    await act(async () => pending.promise);
    expect(screen.queryByText("storefront_shell_status_validating")).toBeNull();
    expect(screen.getByText("storefront_shell_status_unsaved")).toBeVisible();
  });
});

describe("StorefrontShellEditor actor isolation", () => {
  it("clears actor A immediately and ignores late load/save/validate/upload results", async () => {
    const actorALoad = deferred<AdminShellSnapshot>();
    const actorBLoad = deferred<AdminShellSnapshot>();
    apiMock.get
      .mockReturnValueOnce(actorALoad.promise)
      .mockReturnValueOnce(actorBLoad.promise);
    const view = renderEditor();

    authState.admin = {
      id: "actor-b",
      name: "Actor B",
      email: "b@example.com",
      status: "ACTIVE",
      roles: [],
      permissions: ["STOREFRONT_SHELL_MANAGE"],
    };
    view.rerender(
      <StorefrontShellEditor>
        <EditorProbe />
      </StorefrontShellEditor>,
    );
    actorALoad.resolve(snapshot("Actor A private"));
    await act(async () => actorALoad.promise);

    expect(screen.queryByDisplayValue("Actor A private")).toBeNull();
    expect(screen.queryByTestId("editor-probe")).toBeNull();
    expect(screen.getByText("storefront_shell_loading")).toBeVisible();

    actorBLoad.resolve(snapshot("Actor B shell"));
    expect(await screen.findByDisplayValue("Actor B shell")).toBeVisible();

    const save = deferred<AdminShellSnapshot>();
    const validateRequest = deferred<AdminShellValidationResult>();
    const upload = deferred<AdminShellUploadResult>();
    apiMock.save.mockReturnValueOnce(save.promise);
    apiMock.validate.mockReturnValueOnce(validateRequest.promise);
    apiMock.upload.mockReturnValueOnce(upload.promise);
    fireEvent.click(screen.getByRole("button", { name: "Probe edit" }));
    fireEvent.click(screen.getByRole("button", { name: "storefront_shell_save" }));
    fireEvent.click(screen.getByRole("button", { name: "Probe validate" }));
    fireEvent.click(screen.getByRole("button", { name: "Probe upload" }));
    expect(screen.getByTestId("probe-pending")).toHaveTextContent("horizontal");

    authState.admin = {
      id: "actor-c",
      name: "Actor C",
      email: "c@example.com",
      status: "ACTIVE",
      roles: [],
      permissions: ["STOREFRONT_SHELL_MANAGE"],
    };
    const actorCLoad = deferred<AdminShellSnapshot>();
    apiMock.get.mockReturnValueOnce(actorCLoad.promise);
    view.rerender(
      <StorefrontShellEditor>
        <EditorProbe />
      </StorefrontShellEditor>,
    );

    expect(screen.queryByDisplayValue("Probe edit")).toBeNull();
    expect(screen.queryByTestId("editor-probe")).toBeNull();
    save.resolve(snapshot("Actor B stale save", 8, true));
    validateRequest.resolve(validation(documentFor("Actor B stale validation")));
    upload.resolve({
      version: 7,
      issues: [],
      asset: snapshot().assets[HORIZONTAL_ASSET_ID],
    });
    await act(async () => Promise.all([save.promise, validateRequest.promise, upload.promise]));
    expect(screen.queryByText(/Actor B stale/)).toBeNull();
    expect(screen.getByText("storefront_shell_loading")).toBeVisible();

    actorCLoad.resolve(snapshot("Actor C shell"));
    expect(await screen.findByDisplayValue("Actor C shell")).toBeVisible();
  });

  it("removes draft content immediately when permission is lost", async () => {
    const validationRequest = deferred<AdminShellValidationResult>();
    apiMock.validate.mockReturnValueOnce(validationRequest.promise);
    const view = await readyEditor("Sensitive draft");
    fireEvent.click(screen.getByRole("button", { name: "Probe validate" }));

    authState.permissions = [];
    authState.admin = authState.admin
      ? { ...authState.admin, permissions: [] }
      : null;
    view.rerender(
      <StorefrontShellEditor>
        <EditorProbe />
      </StorefrontShellEditor>,
    );

    expect(screen.getByText("storefront_shell_permission_denied")).toBeVisible();
    expect(screen.queryByDisplayValue("Sensitive draft")).toBeNull();
    expect(screen.queryByTestId("editor-probe")).toBeNull();
    validationRequest.resolve(validation(documentFor("Sensitive stale result")));
    await act(async () => validationRequest.promise);
    expect(screen.queryByText(/Sensitive/)).toBeNull();
  });

  it("never requests or renders draft content for an unauthorized account", () => {
    authState.permissions = ["PRODUCT_MANAGE"];
    authState.admin = authState.admin
      ? { ...authState.admin, permissions: ["PRODUCT_MANAGE"] }
      : null;
    renderEditor();

    expect(screen.getByText("storefront_shell_permission_denied")).toBeVisible();
    expect(apiMock.get).not.toHaveBeenCalled();
    expect(screen.queryByTestId("editor-probe")).toBeNull();
  });
});
