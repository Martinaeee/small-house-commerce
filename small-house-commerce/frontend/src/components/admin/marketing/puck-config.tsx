import type { Config } from "@puckeditor/core";
import type { ReactNode } from "react";
import type { AdminI18n } from "@/lib/admin-i18n";
import { LandingBlocksLayout } from "@/components/product/LandingContentView";
import { MarketingMediaField } from "./MarketingMediaField";
import {
  editorBlockToContent,
  type LandingBlock,
  type LandingMedia,
  type MarketingEditorProps,
  type MarketingEditorRoot,
} from "@/lib/marketing-content";

type EditorConfig = Config<MarketingEditorProps, Partial<MarketingEditorRoot>>;
type Components = EditorConfig["components"];

export function marketingPuckConfig(renderBlock: (block: LandingBlock) => ReactNode, t: AdminI18n["t"]): EditorConfig {
  function component<K extends keyof Components>(
    type: K,
    label: string,
    fields: Components[K]["fields"],
    defaultProps: Record<string, unknown>,
    permissions?: Components[K]["permissions"],
  ): Components[K] {
    return {
      label, fields, permissions,
      defaultProps: { sourceKey: null, sourceBlockId: null, ...defaultProps },
      render: (props) => renderBlock(editorBlockToContent({ type, props })),
    } as Components[K];
  }
  const mediaFields = {
    media: {
      type: "custom" as const,
      label: t("marketing_field_media"),
      render: ({ value, onChange, readOnly }: { value: LandingMedia[]; onChange: (media: LandingMedia[]) => void; readOnly?: boolean }) => <MarketingMediaField value={value} onChange={onChange} readOnly={readOnly} />,
    },
  };
  const textFields = {
    html: {
      type: "richtext" as const,
      label: t("marketing_block_richText"),
      options: {
        heading: { levels: [3, 4] as [3, 4] },
        code: false as const,
        codeBlock: false as const,
        blockquote: false as const,
        underline: false as const,
        strike: false as const,
        textAlign: false as const,
        horizontalRule: false as const,
        link: { openOnClick: false, protocols: ["http", "https", "mailto"] },
      },
    },
  };
  const livePermissions = { edit: false, duplicate: false };
  const fixedLeadPermissions = { duplicate: false, delete: false, insert: false };
  return {
    root: {
      fields: {},
      render: ({ children }) => <LandingBlocksLayout>{children}</LandingBlocksLayout>,
    },
    components: {
      hero: component("hero", t("marketing_block_hero"), {
        title: { type: "text", label: t("marketing_field_title") },
        tagline: { type: "textarea", label: t("marketing_field_tagline") },
        promoHeadline: { type: "text", label: t("marketing_field_promo_headline") },
        promoSubtext: { type: "textarea", label: t("marketing_field_promo_subtext") },
      }, { title: "Campaign title", tagline: null, promoHeadline: null, promoSubtext: null }, fixedLeadPermissions),
      gallery: component("gallery", t("marketing_block_gallery"), mediaFields, { media: [] }, fixedLeadPermissions),
      buy: component("buy", t("marketing_block_buy"), {}, {}, { ...fixedLeadPermissions, drag: false, edit: false }),
      richText: component("richText", t("marketing_block_richText"), textFields, { html: "<p></p>" }),
      detail: component("detail", t("marketing_block_detail"), mediaFields, { media: [] }),
      facts: component("facts", t("marketing_block_facts"), {}, {}, livePermissions),
      reviews: component("reviews", t("marketing_block_reviews"), {}, {}, livePermissions),
      faq: component("faq", t("marketing_block_faq"), {}, {}, livePermissions),
      custom: component("custom", t("marketing_block_custom"), textFields, { html: "<p></p>" }),
    },
  };
}
