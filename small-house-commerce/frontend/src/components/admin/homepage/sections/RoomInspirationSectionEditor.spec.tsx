import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { RoomInspirationSectionEditor } from "@/components/admin/homepage/sections/RoomInspirationSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const listProducts = vi.hoisted(() => vi.fn());
const getProduct = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { listProducts, getProduct } }));

type RoomSection = SectionOf<"ROOM_INSPIRATION">;
const ROOM_ID = "00000000-0000-7000-8000-000000000106";
const PRODUCT_ONE = "00000000-0000-7000-8000-000000000501";
const PRODUCT_TWO = "00000000-0000-7000-8000-000000000502";

function makeSection(
  payload: Partial<SectionPayloadMap["ROOM_INSPIRATION"]> = {},
): RoomSection {
  return {
    id: ROOM_ID,
    type: "ROOM_INSPIRATION",
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: 60,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload,
  };
}

function Harness({
  initial = {},
}: {
  initial?: Partial<SectionPayloadMap["ROOM_INSPIRATION"]>;
}): ReactNode {
  const [payload, setPayload] = useState<SectionPayloadMap["ROOM_INSPIRATION"]>(initial);
  return (
    <>
      <RoomInspirationSectionEditor
        section={makeSection(payload)}
        onPayloadChange={(patch) =>
          setPayload((current) =>
            typeof patch === "function" ? patch(current) : { ...current, ...patch },
          )
        }
      />
      <pre data-testid="room-payload">{JSON.stringify(payload)}</pre>
    </>
  );
}

const products = [
  {
    id: PRODUCT_ONE,
    name: "Oak coffee table",
    slug: "oak-coffee-table",
    images: [
      { id: "image-1", url: "/uploads/oak.jpg", type: "IMAGE" as const, altText: null, sortOrder: 0 },
    ],
    variants: [],
  },
  {
    id: PRODUCT_TWO,
    name: "Linen lounge chair",
    slug: "linen-lounge-chair",
    images: [
      { id: "image-2", url: "/uploads/linen.jpg", type: "IMAGE" as const, altText: null, sortOrder: 0 },
    ],
    variants: [],
  },
];

describe("RoomInspirationSectionEditor", () => {
  beforeEach(() => {
    listProducts.mockReset().mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    getProduct.mockReset().mockRejectedValue(new Error("not linked"));
  });

  it("shows the linked product photo and name on the hotspot row", async () => {
    setAdminLang("en");
    getProduct.mockResolvedValue(products[0]);
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [
              {
                id: "scene001",
                imageUrl: "https://example.com/room.jpg",
                hotspots: [{ productId: PRODUCT_ONE, xPct: 20, yPct: 30 }],
              },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    const row = await waitFor(() => {
      const found = document.querySelector('[data-room-hotspot-row="scene001-0"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(row).toHaveTextContent("Oak coffee table");
    expect(within(row).getByTestId("room-hotspot-product-thumb")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
    expect(row).not.toHaveTextContent(PRODUCT_ONE);
  });

  it("shows the product photo next to each name in the hotspot picker", async () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [{ id: "scene001", imageUrl: "https://example.com/room.jpg", hotspots: [] }],
          }}
        />
      </AdminI18nProvider>,
    );

    const canvas = document.querySelector('[data-room-scene-canvas="scene001"]');
    expect(canvas).not.toBeNull();
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 100, top: 50, width: 200, height: 100 }),
    });
    fireEvent.click(canvas as HTMLElement, { clientX: 150, clientY: 100 });

    const dialog = await screen.findByRole("dialog", { name: "Choose product for hotspot" });
    const option = await within(dialog).findByRole("button", { name: "Oak coffee table" });
    expect(within(option).getByTestId("room-hotspot-option-thumb-oak-coffee-table")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
  });

  it("requires a scene image before creating a scene", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add scene" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose scene image" });
    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}").scenes ?? []).toHaveLength(0);
    expect(within(dialog).getByRole("button", { name: "Add scene" })).toBeDisabled();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Scene image URL" }), {
      target: { value: "https://example.com/new-room.jpg" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add scene" }));

    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}")).toMatchObject({
      scenes: [{ imageUrl: "https://example.com/new-room.jpg", hotspots: [] }],
    });
  });

  it("normalizes malformed content, keeps scene identities, and caps scenes at five", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [
              { id: "scene001", imageUrl: "https://example.com/room.jpg", hotspots: [] },
              null as unknown as SectionPayloadMap["ROOM_INSPIRATION"]["scenes"] extends Array<infer T>
                ? T
                : never,
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getByTestId("room-scene-row-scene001")).toBeVisible();
    expect(screen.getByText("The backend accepts up to 5 scenes.")).toBeVisible();
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Add scene" }));
      const dialog = await screen.findByRole("dialog", { name: "Choose scene image" });
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Scene image URL" }), {
        target: { value: `https://example.com/room-${index + 2}.jpg` },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add scene" }));
    }
    expect(screen.getByRole("button", { name: "Add scene" })).toBeDisabled();
  });

  it("creates backend-valid unique ids for new and duplicate legacy scenes", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [
              { id: "scene001", imageUrl: "https://example.com/one.jpg", hotspots: [] },
              { id: "scene001", imageUrl: "https://example.com/two.jpg", hotspots: [] },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getAllByTestId(/room-scene-row-/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove scene 2" }));
    const afterRemove = JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}");
    expect(afterRemove.scenes).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Add scene" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose scene image" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Scene image URL" }), {
      target: { value: "https://example.com/three.jpg" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add scene" }));
    const nextId = JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}").scenes.at(-1).id;
    expect(nextId).toMatch(/^[a-z0-9]{8,16}$/);
  });

  it("sanitizes capped scenes and coordinates when an unrelated field is edited", () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: Array.from({ length: 6 }, (_, index) => ({
              id: `scene${String(index + 1).padStart(3, "0")}`,
              imageUrl: "https://example.com/room.jpg",
              hotspots: [{ productId: PRODUCT_ONE, xPct: -20, yPct: 180 }],
            })),
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Room inspiration heading" }), {
      target: { value: "Sanitized room" },
    });
    const payload = JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}");
    expect(payload.scenes).toHaveLength(5);
    expect(payload.scenes[0].hotspots[0]).toMatchObject({ xPct: 0, yPct: 100 });
  });

  it("opens the product picker at the clicked position and confirms a product", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [{ id: "scene001", imageUrl: "https://example.com/room.jpg", hotspots: [] }],
          }}
        />
      </AdminI18nProvider>,
    );

    const canvas = document.querySelector('[data-room-scene-canvas="scene001"]');
    expect(canvas).not.toBeNull();
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 100, top: 50, width: 200, height: 100 }),
    });

    fireEvent.click(canvas as HTMLElement, { clientX: 150, clientY: 100 });

    const dialog = await screen.findByRole("dialog", { name: "Choose product for hotspot" });
    expect(await within(dialog).findByRole("button", { name: "Oak coffee table" })).toBeVisible();
    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}")).toMatchObject({
      scenes: [
        {
          id: "scene001",
          hotspots: [{ productId: "", xPct: 25, yPct: 50 }],
        },
      ],
    });

    const productButton = await within(dialog).findByRole("button", { name: "Oak coffee table" });
    fireEvent.click(productButton);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm selected product (1/1)" }));

    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}")).toMatchObject({
      scenes: [
        {
          id: "scene001",
          hotspots: [{ productId: PRODUCT_ONE, xPct: 25, yPct: 50 }],
        },
      ],
    });

    const hotspotReplaceButton = screen.getByRole("button", {
      name: "Replace product for hotspot 1 on scene 1",
    });
    expect(hotspotReplaceButton).toHaveTextContent("Replace product");
    expect(screen.getByRole("button", { name: "Relocate hotspot 1 on scene 1" })).toHaveTextContent(
      "Relocate on image",
    );
    expect(screen.getByRole("button", { name: "Remove hotspot 1 from scene 1" })).toHaveTextContent(
      "Remove",
    );

    fireEvent.click(screen.getByRole("button", { name: "Relocate hotspot 1 on scene 1" }));
    fireEvent.click(canvas as HTMLElement, { clientX: 250, clientY: 130 });
    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}").scenes[0].hotspots[0]).toMatchObject({
      xPct: 75,
      yPct: 80,
    });
  });

  it("filters products in the picker and disables products already assigned in the scene", async () => {
    setAdminLang("en");
    listProducts.mockImplementation(({ search }: { search?: string }) => {
      const items = search
        ? products.filter((product) => product.name.toLowerCase().includes(search.toLowerCase()))
        : products;
      return Promise.resolve({ items, total: items.length, page: 1, pageSize: 20 });
    });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [
              {
                id: "scene001",
                imageUrl: "https://example.com/room.jpg",
                hotspots: [{ productId: PRODUCT_ONE, xPct: 20, yPct: 30 }],
              },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    const canvas = document.querySelector('[data-room-scene-canvas="scene001"]');
    expect(canvas).not.toBeNull();
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 100, top: 50, width: 200, height: 100 }),
    });
    fireEvent.click(canvas as HTMLElement, { clientX: 160, clientY: 90 });

    const dialog = await screen.findByRole("dialog", { name: "Choose product for hotspot" });
    const productButton = await within(dialog).findByRole("button", { name: "Oak coffee table" });
    expect(productButton).toBeDisabled();
    const search = within(dialog).getByRole("searchbox", { name: "Search products" });
    fireEvent.change(search, { target: { value: "Linen" } });
    await waitFor(() => expect(listProducts).toHaveBeenLastCalledWith(
      { search: "Linen", page: 1, pageSize: 20 },
    ));
    expect(await within(dialog).findByRole("button", { name: "Linen lounge chair" })).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "Oak coffee table" })).toBeNull();
  });

  it("removes a new empty hotspot when the picker is cancelled", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [{ id: "scene001", imageUrl: "https://example.com/room.jpg", hotspots: [] }],
          }}
        />
      </AdminI18nProvider>,
    );

    const canvas = document.querySelector('[data-room-scene-canvas="scene001"]');
    expect(canvas).not.toBeNull();
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 100, top: 50, width: 200, height: 100 }),
    });
    fireEvent.click(canvas as HTMLElement, { clientX: 150, clientY: 100 });
    const dialog = await screen.findByRole("dialog", { name: "Choose product for hotspot" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}").scenes[0].hotspots).toEqual([]);
  });

  it("preserves an existing unassigned hotspot when its picker is cancelled", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [{
              id: "scene001",
              imageUrl: "https://example.com/room.jpg",
              hotspots: [{ productId: "", xPct: 20, yPct: 30 }],
            }],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace product for hotspot 1 on scene 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose product for hotspot" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}").scenes[0].hotspots).toEqual([
      { productId: "", xPct: 20, yPct: 30 },
    ]);
  });

  it("keeps keyboard-operable hotspot creation and coordinate controls", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [{ id: "scene001", imageUrl: "https://example.com/room.jpg", hotspots: [] }],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add hotspot to scene 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose product for hotspot" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Oak coffee table" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm selected product (1/1)" }));

    fireEvent.change(screen.getByRole("spinbutton", { name: "Hotspot 1 x-position for scene 1" }), {
      target: { value: "72" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Hotspot 1 y-position for scene 1" }), {
      target: { value: "35" },
    });

    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}").scenes[0].hotspots[0]).toEqual({
      productId: PRODUCT_ONE,
      xPct: 72,
      yPct: 35,
    });
  });

  it("preserves an existing product when replacement is cancelled", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [{
              id: "scene001",
              imageUrl: "https://example.com/room.jpg",
              hotspots: [{ productId: PRODUCT_ONE, xPct: 20, yPct: 30 }],
            }],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace product for hotspot 1 on scene 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose product for hotspot" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Linen lounge chair" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}").scenes[0].hotspots[0].productId).toBe(PRODUCT_ONE);
  });

  it("replaces an existing product after confirmation", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [{
              id: "scene001",
              imageUrl: "https://example.com/room.jpg",
              hotspots: [{ productId: PRODUCT_ONE, xPct: 20, yPct: 30 }],
            }],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace product for hotspot 1 on scene 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose product for hotspot" });
    const replacement = await within(dialog).findByRole("button", { name: "Linen lounge chair" });
    fireEvent.click(replacement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm selected product (1/1)" }));

    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}").scenes[0].hotspots[0].productId).toBe(PRODUCT_TWO);
  });

  it("clears an existing product association without treating empty hotspots as duplicates", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            scenes: [{
              id: "scene001",
              imageUrl: "https://example.com/room.jpg",
              hotspots: [
                { productId: PRODUCT_ONE, xPct: 20, yPct: 30 },
                { productId: "", xPct: 70, yPct: 80 },
              ],
            }],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace product for hotspot 1 on scene 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose product for hotspot" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear product" }));

    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}").scenes[0].hotspots[0].productId).toBe("");
  });

  it("supports heading edits and leaves the eighth hotspot at the backend bound", () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            heading: "A room to return to",
            scenes: [
              {
                id: "scene001",
                imageUrl: "https://example.com/room.jpg",
                hotspots: Array.from({ length: 8 }, (_, index) => ({
                  productId: `${PRODUCT_ONE.slice(0, -1)}${index}`,
                  xPct: index,
                  yPct: index,
                })),
              },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Room inspiration heading" }), {
      target: { value: "Updated room story" },
    });
    const canvas = document.querySelector('[data-room-scene-canvas="scene001"]');
    expect(canvas).not.toBeNull();
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 100, top: 50, width: 200, height: 100 }),
    });
    fireEvent.click(canvas as HTMLElement, { clientX: 150, clientY: 100 });

    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}")).toMatchObject({
      heading: "Updated room story",
    });
    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}").scenes[0].hotspots).toHaveLength(8);
  });
});
