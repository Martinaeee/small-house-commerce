import { render, screen } from "@testing-library/react";
import { Render } from "@puckeditor/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { marketingPuckConfig } from "./puck-config";
import { zh } from "@/i18n/zh";
const t = (key: keyof typeof zh) => zh[key];
import { fromPuckData, toPuckData, withFixedProductLead, type LandingContent } from "@/lib/marketing-content";

vi.hoisted(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
});
afterAll(() => vi.unstubAllGlobals());

const content: LandingContent = {
  schemaVersion: 1,
  seoTitle: "Campaign title",
  seoDescription: null,
  startAt: null,
  endAt: null,
  blocks: [
    { id: "hero", type: "hero", sourceKey: "hero:p1", props: { title: "Independent campaign", tagline: null, promoHeadline: null, promoSubtext: null } },
    { id: "buy", type: "buy", sourceKey: "buy:p1", props: {} },
  ],
};

describe("controlled marketing editor", () => {
  it("uses native rich text with only server-supported formatting", () => {
    const config = marketingPuckConfig(() => null, t);
    for (const type of ["richText", "custom"] as const) expect(config.components[type].fields?.html).toMatchObject({ type: "richtext", options: { heading: { levels: [3, 4] }, code: false, codeBlock: false, blockquote: false, underline: false, strike: false, textAlign: false, horizontalRule: false } });
  });

  it("localizes module fields without exposing duplicate raw ISO settings", () => {
    const config = marketingPuckConfig(() => null, t);
    expect(config.components.hero.label).toBe("商品标题与促销（固定）");
    expect(config.components.hero.fields?.title.label).toBe("展示标题");
    expect(config.components.gallery.label).toBe("顶部商品图库（固定）");
    expect(config.components.buy.label).toBe("实时购物信息（固定）");
    expect(config.root?.fields).toEqual({});
  });

  it("renders saved display content and delegates purchase to the live renderer", () => {
    const config = marketingPuckConfig((block) => block.type === "hero"
      ? <h1>{block.props.title}</h1>
      : <button>Buy now — live SKU</button>, t);
    render(<Render config={config} data={toPuckData(content)} />);
    expect(screen.getByRole("heading", { name: "Independent campaign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy now — live SKU" })).toBeInTheDocument();
  });

  it("registers only nine approved blocks and locks the inherited product lead in place", () => {
    const config = marketingPuckConfig(() => null, t);
    expect(Object.keys(config.components).sort()).toEqual(["buy", "custom", "detail", "facts", "faq", "gallery", "hero", "reviews", "richText"].sort());
    for (const type of ["hero", "gallery"] as const) {
      expect(config.components[type].permissions).toMatchObject({ delete: false, duplicate: false, insert: false });
      expect(config.components[type].permissions?.drag).not.toBe(false);
      expect(config.components[type].permissions?.edit).not.toBe(false);
    }
    expect(config.components.buy.fields ?? {}).toEqual({});
    expect(config.components.buy.permissions).toMatchObject({ drag: false, delete: false, duplicate: false, insert: false, edit: false });
    for (const type of ["facts", "reviews", "faq"] as const) {
      expect(config.components[type].fields ?? {}).toEqual({});
      expect(config.components[type].permissions?.edit).toBe(false);
    }
  });

  it("pins the inherited product lead before reorderable detail blocks", () => {
    const gallery = { id: "gallery", type: "gallery" as const, sourceKey: "gallery:p1", props: { media: [] } };
    const custom = { id: "custom", type: "custom" as const, sourceKey: null, props: { html: "<p>Custom</p>" } };
    const scrambled: LandingContent = { ...content, blocks: [custom, content.blocks[1], content.blocks[0], gallery] };

    expect(withFixedProductLead(scrambled).blocks.map((block) => block.type)).toEqual(["hero", "gallery", "buy", "custom"]);
  });

  it("round trips canonical content without editor metadata", () => {
    expect(fromPuckData(toPuckData(content))).toEqual(content);
  });

  it("preserves saved draft schedule settings", () => {
    const scheduled = { ...content, startAt: "2026-10-15T01:00:00Z", endAt: "2026-10-16T01:00:00Z" };
    expect(fromPuckData(toPuckData(scheduled))).toEqual(scheduled);
  });

  it("turns duplicated source blocks into independent blocks regardless of ordering", () => {
    const data = toPuckData(content);
    const original = data.content.find((item) => item.type === "hero")!;
    data.content.unshift({ ...original, props: { ...original.props, id: "hero-copy" } });
    const result = fromPuckData(data);
    expect(result.blocks[0]).toMatchObject({ id: "hero-copy", sourceKey: null });
    expect(result.blocks[1]).toMatchObject({ id: "hero", sourceKey: "hero:p1" });
  });

  it("does not persist runtime properties or fabricated purchase truth", () => {
    const data = toPuckData(content);
    Object.assign(data.content[1].props, { price: 1, stock: 99, skuId: "spoof", puck: { dragRef: "runtime" } });
    expect(fromPuckData(data).blocks[1].props).toEqual({});
  });

  it("rejects unsupported components rather than executing them", () => {
    const data = toPuckData(content);
    Object.assign(data.content[0], { type: "script" });
    expect(() => fromPuckData(data)).toThrow(/Unsupported/);
  });
});
