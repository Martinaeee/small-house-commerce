import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config, Data, Dictionary, FieldTransforms } from "@puckeditor/core";
import MarketingCanvas from "./MarketingCanvas";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import type { LandingContent, MarketingEditorData, MarketingEditorProps, MarketingEditorRoot } from "@/lib/marketing-content";

type EditorConfig = Config<MarketingEditorProps, Partial<MarketingEditorRoot>>;
interface CanvasBoundary {
  config: EditorConfig;
  data: MarketingEditorData;
  onChange: (data: Data<MarketingEditorProps, Partial<MarketingEditorRoot>>) => void;
  fieldTransforms: FieldTransforms;
  height?: string | number;
  dictionary?: Dictionary;
}
vi.mock("@puckeditor/core", () => ({ Puck: (props: CanvasBoundary) => <>
  <output data-testid="editor-height">{props.height ?? "default 100dvh"}</output>
  <output data-testid="viewport-label">{props.dictionary?.["viewport-switch"]}</output>
  <button onClick={() => props.onChange({ ...props.data, root: { props: {} } })}>Empty editor root</button>
  {props.data.content.filter((block) => block.type === "richText").map((block) => <React.Fragment key={block.props.id}>
    {props.config.components.richText.render({ ...block.props, html: props.fieldTransforms.richtext!({ value: block.props.html, componentId: block.props.id, propName: "html", propPath: "html", isReadOnly: false, field: { type: "richtext" } }) } as Parameters<EditorConfig["components"]["richText"]["render"]>[0])}
  </React.Fragment>)}
</> }));
const saved: LandingContent = { schemaVersion: 1, seoTitle: "Saved SEO", seoDescription: "Saved description", startAt: "2026-10-15T01:00:00Z", endAt: "2026-10-16T01:00:00Z", blocks: [{ id: "buy", type: "buy", sourceKey: null, props: {} }, { id: "body", type: "richText", sourceKey: null, props: { html: "<p>Saved body</p>" } }] };
const edited: LandingContent = { ...saved, blocks: [saved.blocks[0], { id: "body", type: "richText", sourceKey: null, props: { html: '<p onclick="bad()"><strong>Unsaved body</strong></p><script>bad()</script>' } }] };
const projection: LandingContent = { ...edited, blocks: [edited.blocks[0], { id: "body", type: "richText", sourceKey: null, props: { html: "<p><strong>Unsaved body</strong></p>" } }] };
function mount(content: LandingContent, validatedPreview: LandingContent | null, onChange = vi.fn()) {
  return render(<AdminI18nProvider><MarketingCanvas pageId="page-1" content={content} approvedContent={saved} validatedPreview={validatedPreview} product={null} readOnly={false} onChange={onChange} onUploadingChange={vi.fn()} /></AdminI18nProvider>);
}
beforeEach(() => localStorage.clear());
describe("native canvas rendering boundary", () => {
  it("keeps the native sidebar and mobile toolbar inside the bounded editor height", () => {
    mount(saved, null);
    expect(screen.getByTestId("editor-height")).toHaveTextContent(/^100%$/);
  });
  it("keeps each native viewport label instead of calling both phone and desktop desktop", () => {
    mount(saved, null);
    expect(screen.getByTestId("viewport-label")).toHaveTextContent("{label}");
  });
  it("preserves parent-managed SEO and schedule when the editor has no root fields", () => {
    const onChange = vi.fn(); mount(saved, null, onChange);
    fireEvent.click(screen.getByRole("button", { name: "Empty editor root" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved);
  });
  it("renders server-validated formatting rather than approving raw edited HTML", () => {
    const { container } = mount(edited, projection);
    expect(container.querySelector("strong")).toHaveTextContent("Unsaved body");
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
  it("keeps changed HTML literal while validation is pending or failed", () => {
    const { container } = mount(edited, null);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    const text = edited.blocks.find((block) => block.type === "richText")!;
    expect(container).toHaveTextContent(text.props.html);
  });
});
