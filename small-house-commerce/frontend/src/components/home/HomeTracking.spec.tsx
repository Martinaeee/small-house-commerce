import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HomepageSection } from "@/lib/api";
import { api } from "@/lib/api";
import { CartProvider } from "@/components/cart/CartContext";
import { cardTestProduct } from "@/test/product-card-fixtures";
import { HomeTracking } from "./HomeTracking";
import { ProductGridSection } from "./ProductGridSection";

const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
vi.mock("@/lib/tracking", () => ({ ...tracking, currentMarketingCredential: vi.fn(() => null) }));

const section: HomepageSection = {
  id: "10000000-0000-7000-8000-000000000001", type: "PRODUCT_GRID",
  title: "Selected tables", subtitle: null, sortOrder: 0, payload: {},
  products: [{ ...cardTestProduct(), badge: "New" }, { ...cardTestProduct({ id: "product-2", name: "Second table", slug: "second-table" }), badge: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(api, "addToCart").mockResolvedValue({ cartId: "tracking-cart", items: [], subtotal: 120, discount: 0,
    shipping: 0, total: 120, expiresAt: "2030-01-01T00:00:00Z", created: true });
});

function renderTrackedGrid(grid = section) {
  return render(<CartProvider><HomeTracking /><ProductGridSection section={grid} /></CartProvider>);
}

describe("HomeTracking with inline product cards", () => {
  it("counts navigation but not option or purchase clicks as ProductClick", async () => {
    const { container } = renderTrackedGrid();
    const article = container.querySelector("article")!;
    const user = userEvent.setup();
    tracking.trackCustom.mockClear();
    await user.click(within(article).getByRole("button", { name: "Blue" }));
    await user.click(within(article).getByRole("button", { name: "Add to Cart" }));
    await within(article).findByRole("button", { name: "Added" });
    expect(tracking.trackCustom.mock.calls.filter(([name]) => name === "ProductClick")).toHaveLength(0);
    expect(tracking.track).toHaveBeenCalledWith("AddToCart", expect.objectContaining({ content_ids: ["blue-sku"] }), expect.objectContaining({ eventID: expect.any(String) }));
    const title = within(screen.getByRole("heading", { name: "Oak Side Table" })).getByRole("link");
    title.addEventListener("click", event => event.preventDefault());
    await user.click(title);
    expect(tracking.trackCustom).toHaveBeenCalledWith("ProductClick", { section_id: section.id, section_name: "Selected tables", position: 1 });
  });

  it("does not count opening, searching or closing more options as navigation or a commerce action", async () => {
    const product = cardTestProduct();
    const option = product.options[0]!;
    option.values = Array.from({ length: 12 }, (_, index) => ({
      id: `long-${index}`, label: `Performance Multi Twill, Cream with finish ${index}`, position: index,
      swatchHex: null, thumbnailUrl: null, thumbnailAlt: null,
    }));
    const source = product.variants[0]!;
    product.variants = option.values.map(value => ({ ...source, id: `variant-${value.id}`, name: value.label,
      optionValueIds: [value.id], combinationKey: `color:${value.id}`, sku: { ...source.sku!, id: `sku-${value.id}` },
    }));
    renderTrackedGrid({ ...section, products: [{ ...product, badge: null }] });
    tracking.track.mockClear();
    tracking.trackCustom.mockClear();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More Color options" }));
    await user.type(screen.getByRole("searchbox", { name: "Search options" }), "finish 11");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More Color options" })).toHaveFocus();
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
    expect(api.addToCart).not.toHaveBeenCalled();
  });

  it("tracks both true details links and preserves the second product's position", async () => {
    const { container } = renderTrackedGrid();
    const article = container.querySelectorAll("article")[1]!;
    const links = within(article).getAllByRole("link", { name: "Second table" });
    expect(links).toHaveLength(2);
    tracking.trackCustom.mockClear();
    for (const link of links) {
      link.addEventListener("click", event => event.preventDefault());
      await userEvent.click(link);
    }
    const clicks = tracking.trackCustom.mock.calls.filter(([name]) => name === "ProductClick");
    expect(clicks).toEqual([
      ["ProductClick", { section_id: section.id, section_name: "Selected tables", position: 2 }],
      ["ProductClick", { section_id: section.id, section_name: "Selected tables", position: 2 }],
    ]);
  });

  it("places ProductClick attributes only on the image and title links", () => {
    const { container } = renderTrackedGrid();
    const targets = [...container.querySelectorAll('[data-track-event="ProductClick"]')];
    expect(targets).toHaveLength(4);
    expect(targets.map(node => node.tagName)).toEqual(["A", "A", "A", "A"]);
    for (const article of container.querySelectorAll("article")) {
      for (const button of within(article).getAllByRole("button")) {
        expect(button.closest('[data-track-event="ProductClick"]')).toBeNull();
      }
    }
  });
});
