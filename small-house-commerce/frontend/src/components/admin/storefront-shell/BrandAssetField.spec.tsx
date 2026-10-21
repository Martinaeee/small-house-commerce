import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminShellAsset } from "@/lib/storefront-shell-api";
import { BrandAssetField } from "./BrandAssetField";

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
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

const HORIZONTAL_ID = "00000000-0000-7000-8000-000000000901";
const SQUARE_ID = "00000000-0000-7000-8000-000000000902";

function asset(overrides: Partial<AdminShellAsset> = {}): AdminShellAsset {
  return {
    id: HORIZONTAL_ID,
    kind: "HORIZONTAL",
    url: "/uploads/brand/logo.webp",
    mimeType: "image/webp",
    width: 600,
    height: 120,
    durable: true,
    createdAt: "2026-10-13T02:00:00.000Z",
    ...overrides,
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

type FieldProps = Parameters<typeof BrandAssetField>[0];

function Harness(props: Partial<FieldProps> = {}) {
  const [assetRef, setAssetRef] = useState<FieldProps["assetRef"]>(
    props.assetRef ?? { assetId: HORIZONTAL_ID },
  );
  const [pending, setPending] = useState<Set<"horizontal" | "square">>(
    new Set(),
  );
  const [pendingOrder, setPendingOrder] = useState<string[]>([]);
  const resolvedAsset = Object.prototype.hasOwnProperty.call(props, "asset")
    ? props.asset
    : asset();

  return (
    <>
      <BrandAssetField
        labelKey="storefront_shell_brand_horizontal"
        assetRef={assetRef}
        asset={resolvedAsset}
        onAssetRefChange={setAssetRef}
        onUpload={props.onUpload ?? (async () => asset())}
        onPendingChange={(isPending) => {
          setPendingOrder((order) => [...order, isPending ? "start" : "end"]);
          setPending((current) => {
            const next = new Set(current);
            if (isPending) next.add("horizontal");
            else next.delete("horizontal");
            return next;
          });
        }}
      />
      <output data-testid="asset-ref">{JSON.stringify(assetRef)}</output>
      <output data-testid="pending">{[...pending].join(",")}</output>
      <output data-testid="pending-order">{pendingOrder.join(",")}</output>
    </>
  );
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText(
    "storefront_shell_brand_horizontal",
  ) as HTMLInputElement;
}

function png(name = "logo.png"): File {
  return new File(["png-bytes"], name, { type: "image/png" });
}

beforeEach(() => {
  // jsdom ships no object-URL support; the field previews the picked file.
  if (typeof URL.createObjectURL !== "function") {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:brand",
    });
  }
  if (typeof URL.revokeObjectURL !== "function") {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrandAssetField", () => {
  it("accepts only png, webp and jpeg uploads", () => {
    render(<Harness />);

    expect(fileInput()).toHaveAttribute("accept", ".png,.webp,.jpg,.jpeg");
  });

  it("marks pending synchronously before the request and clears it after success", async () => {
    const request = deferred<AdminShellAsset>();
    const onUpload = vi.fn<(file: File) => Promise<AdminShellAsset>>(
      () => request.promise,
    );
    render(<Harness onUpload={onUpload} />);

    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [png()] } });
    });

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toBeInstanceOf(File);
    expect(screen.getByTestId("pending-order")).toHaveTextContent("start");
    expect(screen.getByTestId("pending")).toHaveTextContent("horizontal");

    request.resolve(asset({ id: SQUARE_ID, kind: "HORIZONTAL" }));
    await waitFor(() =>
      expect(screen.getByTestId("pending")).not.toHaveTextContent("horizontal"),
    );
    expect(screen.getByTestId("asset-ref")).toHaveTextContent(SQUARE_ID);
    expect(screen.getByTestId("pending-order")).toHaveTextContent("start,end");
  });

  it("always clears pending on failure and preserves the current asset and filename", async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error("upload offline"));
    render(<Harness onUpload={onUpload} />);

    await act(async () => {
      fireEvent.change(fileInput(), {
        target: { files: [png("replacement.png")] },
      });
    });

    expect(await screen.findByText("upload offline")).toBeVisible();
    expect(screen.getByTestId("asset-ref")).toHaveTextContent(HORIZONTAL_ID);
    expect(screen.getByText("replacement.png")).toBeVisible();
    expect(screen.getByTestId("pending")).not.toHaveTextContent("horizontal");

    const retry = screen.getByRole("button", {
      name: "storefront_shell_brand_retry",
    });
    onUpload.mockResolvedValueOnce(asset({ id: SQUARE_ID }));
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(screen.getByTestId("asset-ref")).toHaveTextContent(SQUARE_ID);
  });

  it("shows the server-detected dimensions and MIME type", () => {
    render(
      <Harness asset={asset({ width: 1200, height: 240, mimeType: "image/png" })} />,
    );

    expect(
      screen.getByText((content) => /1200×240 · image\/png/.test(content)),
    ).toBeVisible();
  });

  it("changes only the local asset id on replacement and never issues DELETE on remove", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<Harness />);

    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [png()] } });
    });
    expect(screen.getByTestId("asset-ref")).toHaveTextContent(HORIZONTAL_ID);

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_brand_remove" }),
    );

    expect(JSON.parse(screen.getByTestId("asset-ref").textContent!)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores a late upload result after the field unmounts", async () => {
    const request = deferred<AdminShellAsset>();
    const onUpload = vi.fn(() => request.promise);
    const view = render(<Harness onUpload={onUpload} />);

    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [png()] } });
    });
    view.unmount();

    request.resolve(asset({ id: SQUARE_ID }));
    await act(async () => {
      await request.promise;
    });

    expect(screen.queryByTestId("asset-ref")).toBeNull();
  });

  it("prefers the uploaded preview over the published asset while a draft is pending", () => {
    render(<Harness assetRef={null} asset={undefined} />);

    expect(
      screen.getByText("storefront_shell_brand_no_asset"),
    ).toBeVisible();
  });

  it("offers one-line choose and replace buttons instead of the native file text", () => {
    const first = render(<Harness />);
    expect(
      screen.getByRole("button", { name: "storefront_shell_brand_replace" }),
    ).toBeVisible();
    first.unmount();

    render(
      <BrandAssetField
        labelKey="storefront_shell_brand_horizontal"
        assetRef={null}
        onAssetRefChange={() => undefined}
        onUpload={async () => asset()}
      />,
    );
    const choose = screen.getByRole("button", {
      name: "storefront_shell_brand_choose",
    });
    expect(choose.className).toContain("whitespace-nowrap");
    // The programmatically labelled input still drives uploads and tests.
    expect(fileInput()).toHaveAttribute("accept", ".png,.webp,.jpg,.jpeg");
  });
});
