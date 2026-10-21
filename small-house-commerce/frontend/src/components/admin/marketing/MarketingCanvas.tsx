"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { marketingApi } from "@/lib/marketing-api";
import { useMediaBatchUpload } from "@/components/admin/product-form/useMediaBatchUpload";
import { MarketingMediaContext } from "./MarketingMediaField";
import { Puck, type Dictionary, type FieldTransforms } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import type { Product } from "@/lib/api";
import { useAdminI18n } from "@/lib/admin-i18n";
import { fromPuckData, toPuckData, withFixedProductLead, type LandingBlock, type LandingContent } from "@/lib/marketing-content";
import { LandingBlocksProvider, LandingContentView, MarketingBlocks } from "@/components/product/LandingContentView";
import { deliveryWindows } from "@/lib/deliveryWindow";
import { marketingPuckConfig } from "./puck-config";

const ValidatedPreview = createContext<LandingContent | null>(null);
// Puck's native rich text must stay a string until the server-approved renderer accepts it.
const fieldTransforms: FieldTransforms = { richtext: ({ value }) => value };

function PreviewBlock({ block }: { block: LandingBlock }) {
  const projection = useContext(ValidatedPreview);
  const validated = projection?.blocks.find((item) => item.id === block.id && item.type === block.type);
  return <MarketingBlocks block={validated ?? block} />;
}

export default function MarketingCanvas({ pageId, content, approvedContent, validatedPreview, product, readOnly, onChange, onUploadingChange }: {
  pageId: string; content: LandingContent; approvedContent: LandingContent; validatedPreview: LandingContent | null; product: Product | null; readOnly: boolean; onChange: (content: LandingContent) => void; onUploadingChange: (pending: boolean) => void;
}) {
  const { t } = useAdminI18n();
  const targets = useRef(new Map<string, () => boolean>());
  const registerTarget = useCallback((key: string, available: () => boolean) => {
    targets.current.set(key, available);
    return () => { if (targets.current.get(key) === available) targets.current.delete(key); };
  }, []);
  const batch = useMediaBatchUpload({ disabled: readOnly, isTargetAvailable: key => targets.current.get(key)?.() ?? false, uploader: (file, contentType) => marketingApi.uploadMedia(pageId, file, contentType), onUploadingChange });
  const config = useMemo(() => marketingPuckConfig((block) => <PreviewBlock block={block} />, t), [t]);
  const data = toPuckData(withFixedProductLead(content));
  const dictionary = useMemo<Dictionary>(() => ({
    "header-undo": t("marketing_editor_undo"),
    "header-redo": t("marketing_editor_redo"),
    "header-toggle-leftsidebar": t("marketing_editor_sidebar"),
    "header-toggle-rightsidebar": t("marketing_editor_sidebar"),
    "header-toggle-menubar": t("marketing_editor_menu"),
    "action-selectparent": t("marketing_editor_parent"),
    "action-duplicate": t("marketing_editor_duplicate"),
    "action-delete": t("marketing_editor_delete"),
    "label-page": t("marketing_editor_page"),
    "label-component": t("marketing_editor_fields"),
    "plugin-blocks": t("marketing_editor_blocks"),
    "plugin-components": t("marketing_editor_blocks"),
    "plugin-outline": t("marketing_editor_outline"),
    "plugin-fields": t("marketing_editor_fields"),
    "field-richtext-bold": t("marketing_editor_bold"),
    "field-richtext-italic": t("marketing_editor_italic"),
    "field-richtext-list-bullet": t("marketing_editor_bullets"),
    "field-richtext-list-ordered": t("marketing_editor_numbers"),
    "field-richtext-listselect-bullet": t("marketing_editor_bullets"),
    "field-richtext-listselect-ordered": t("marketing_editor_numbers"),
    "field-richtext-select": t("marketing_editor_paragraph"),
    "field-richtext-headingselect-3": t("marketing_editor_heading3"),
    "field-richtext-headingselect-4": t("marketing_editor_heading4"),
    "field-arrayitem-add": t("marketing_editor_add"),
    "field-arrayitem-duplicate": t("marketing_editor_duplicate"),
    "field-arrayitem-delete": t("marketing_editor_delete"),
    "viewport-zoom-in": t("marketing_editor_zoom_in"),
    "viewport-zoom-out": t("marketing_editor_zoom_out"),
    "viewport-zoom-auto": t("marketing_editor_zoom_fit"),
    "viewport-toggle-menu": t("marketing_editor_menu"),
    "viewport-switch": t("marketing_canvas_switch"),
    "viewport-switch-default": t("marketing_canvas_switch_menu"),
  }), [t]);
  const delivery = deliveryWindows();
  if (readOnly) return <LandingContentView content={content} approvedContent={approvedContent} product={product} delivery={delivery} preview />;
  return <div className="h-[calc(100dvh-18rem)] min-h-[540px] overflow-hidden rounded-xl border border-admin-border bg-white">
    <ValidatedPreview.Provider value={validatedPreview}>
      <MarketingMediaContext.Provider value={{ pageId, product, batch, registerTarget }}>
      <LandingBlocksProvider product={product} approvedContent={validatedPreview ?? approvedContent} delivery={delivery} preview>
        <Puck height="100%" config={config} data={data} fieldTransforms={fieldTransforms} dictionary={dictionary} onChange={(next) => onChange(withFixedProductLead(fromPuckData({ ...next, root: data.root })))} iframe={{ enabled: true }} viewports={[{ width: 390, label: t("marketing_canvas_mobile") }, { width: 1200, label: t("marketing_canvas_desktop") }]} overrides={{ headerActions: () => <></> }} />
      </LandingBlocksProvider>
      </MarketingMediaContext.Provider>
    </ValidatedPreview.Provider>
  </div>;
}
