import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { RoomInspirationSectionEditor } from "@/components/admin/homepage/sections/RoomInspirationSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const listProducts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { listProducts } }));

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
  { id: PRODUCT_ONE, name: "Oak coffee table" },
  { id: PRODUCT_TWO, name: "Linen lounge chair" },
];

describe("RoomInspirationSectionEditor", () => {
  it("normalizes malformed content, keeps scene identities, and caps scenes at five", () => {
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
    }
    expect(screen.getByRole("button", { name: "Add scene" })).toBeDisabled();
  });

  it("adds hotspots, clamps coordinates, and prevents a duplicate product in one scene", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: products, total: products.length, page: 1, pageSize: 20 });
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

    await waitFor(() => expect(screen.getByRole("button", { name: "Add hotspot to scene 1" })).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Add hotspot to scene 1" }));
    const secondProduct = screen.getByRole("combobox", { name: "Hotspot 2 product for scene 1" });
    expect(within(secondProduct).getByRole("option", { name: "Oak coffee table" })).toBeDisabled();
    fireEvent.change(secondProduct, { target: { value: PRODUCT_TWO } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Hotspot 2 x-position for scene 1" }), {
      target: { value: "-20" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Hotspot 2 y-position for scene 1" }), {
      target: { value: "180" },
    });

    expect(screen.getByRole("spinbutton", { name: "Hotspot 2 x-position for scene 1" })).toHaveValue(0);
    expect(screen.getByRole("spinbutton", { name: "Hotspot 2 y-position for scene 1" })).toHaveValue(100);
    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}")).toMatchObject({
      scenes: [
        {
          id: "scene001",
          hotspots: [
            { productId: PRODUCT_ONE, xPct: 20, yPct: 30 },
            { productId: PRODUCT_TWO, xPct: 0, yPct: 100 },
          ],
        },
      ],
    });
  });

  it("supports heading edits and disables the eighth hotspot add at the backend bound", () => {
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
    expect(screen.getByRole("button", { name: "Add hotspot to scene 1" })).toBeDisabled();
    expect(JSON.parse(screen.getByTestId("room-payload").textContent ?? "{}")).toMatchObject({
      heading: "Updated room story",
    });
  });
});
