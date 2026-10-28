/**
 * Storefront shell document contract — frontend mirror of
 * `backend/src/modules/storefront-shell/storefront-shell-document.ts`
 * (spec docs/superpowers/specs/2026-10-12-storefront-shell-brand-editor-design.md §7–§12).
 *
 * The frontend package keeps its contract modules dependency-free (see
 * `homepage-document.ts`), so the shape rules are hand-written rather than
 * expressed with a schema library. They mirror the backend's Zod schema,
 * including unknown-key rejection, so the editor's local validation and the
 * save/publish gate agree on the same document. The backend remains
 * authoritative; `contracts/storefront-theme-fixtures.json` plus the mirrored
 * suites keep the two implementations from drifting.
 */

import { isSafeInternalPath } from "./internal-path";

export const STOREFRONT_SHELL_SCHEMA_VERSION = 1;

export const SHELL_LIMITS = {
  label: 40,
  footerText: 120,
  tagline: 100,
  description: 300,
  brandName: 80,
  columnTitle: 40,
  supportEmail: 200,
  supportHours: 100,
  trackOrderLabel: 40,
  internalPath: 2048,
  externalUrl: 2048,
  maxEnabledHeaderItems: 8,
  maxHeaderRows: 24,
  maxFooterColumns: 5,
  maxFooterRows: 8,
  maxFooterSocials: 4,
  maxFooterLegal: 3,
  maxFooterPayments: 6,
  paymentLabel: 24,
} as const;

export type StructuredLink =
  | { type: "PRODUCT" | "COLLECTION" | "CATEGORY" | "LANDING"; id: string }
  | { type: "INTERNAL"; path: string }
  | { type: "EXTERNAL"; url: string };

export type ShellAssetRef = { assetId: string } | null;

export type HeaderItem =
  | { id: string; kind: "CATEGORY_ROOT"; targetId: string; labelOverride: string; enabled: boolean }
  | { id: string; kind: "COLLECTION"; targetId: string; labelOverride: string; enabled: boolean }
  | { id: string; kind: "STRUCTURED_LINK"; label: string; link: StructuredLink; enabled: boolean };

export type FooterRow =
  | { id: string; kind: "LINK"; label: string; link: StructuredLink }
  | { id: string; kind: "TEXT"; text: string };

export type FooterColumn =
  | { id: string; kind: "LINKS"; title: string; rows: FooterRow[] }
  | {
      id: string;
      kind: "CONTACT";
      title: string;
      supportEmail: string;
      supportHours: string;
      trackOrderLabel: string;
      trackOrderLink: StructuredLink;
    };

export type FooterSocialNetwork = "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "YOUTUBE";

export type FooterSocial = { id: string; network: FooterSocialNetwork; url: string };

export type FooterLegalLink = { id: string; label: string; href: string };

export type HeadingFont = "SYSTEM" | "POPPINS_HEADING" | "SERIF_HEADING";
export type BodyFont = "SYSTEM";

export type StorefrontThemeSource = {
  primary: string;
  action: string;
  background: string;
  surface: string;
  text: string;
  headingFont: HeadingFont;
  bodyFont: BodyFont;
};

export type DerivedStorefrontTheme = {
  primaryDark: string;
  primaryLight: string;
  actionHover: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  focus: string;
  disabled: string;
  actionForeground: string;
};

export type ShellIssue = {
  code: string;
  path: string[];
  message: string;
  itemId?: string;
  ratio?: number;
  requiredRatio?: number;
};

export type StorefrontShellDocument = {
  schemaVersion: typeof STOREFRONT_SHELL_SCHEMA_VERSION;
  brand: { brandName: string; horizontalLogo: ShellAssetRef; squareMark: ShellAssetRef };
  header: { items: HeaderItem[] };
  footer: {
    tagline: string;
    description: string;
    columns: FooterColumn[];
    copyrightBrand: string;
    socials: FooterSocial[];
    legal: FooterLegalLink[];
    payments: string[];
  };
  theme: StorefrontThemeSource;
};

export type CurrentLuwagShellSeedInput = {
  rootCategories: Array<{ id: string; name: string; sortOrder: number }>;
  navigationCollections: Array<{ id: string; name: string; slug: string; sortOrder: number }>;
  supportEmail: string;
  supportHours: string;
};

export type ShellDocumentParseResult =
  | { success: true; data: StorefrontShellDocument }
  | { success: false; error: { issues: Array<{ path: string[]; message: string }> } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isCredentialFreeHttpsUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
}

class PathError extends Error {
  constructor(
    readonly path: string[],
    message: string,
  ) {
    super(message);
  }
}

function fail(path: string[], message: string): never {
  throw new PathError(path, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rejects unknown keys, mirroring the backend's `.strict()` objects. */
function strict(value: unknown, path: string[], allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) fail(path, "Expected an object");
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail([...path, key], "Unrecognized key");
  }
  return value;
}

function str(value: unknown, path: string[], max: number, min = 0): string {
  if (typeof value !== "string") fail(path, "Expected a string");
  const trimmed = value.trim();
  if (trimmed.length < min) fail(path, `Expected at least ${min} character(s)`);
  if (value.length > max) fail(path, `Expected at most ${max} character(s)`);
  return trimmed;
}

function hex(value: unknown, path: string[]): string {
  if (typeof value !== "string" || !HEX_RE.test(value)) {
    fail(path, "Colors must be six-digit hex values");
  }
  return value.toLowerCase();
}

function parseStructuredLink(value: unknown, path: string[]): StructuredLink {
  const record = strict(value, path, ["type", "id", "path", "url"]);
  switch (record.type) {
    case "PRODUCT":
    case "COLLECTION":
    case "CATEGORY":
    case "LANDING": {
      const id = str(record.id, [...path, "id"], 64, 1);
      if (!UUID_RE.test(id)) fail([...path, "id"], "Expected a UUID");
      return { type: record.type, id };
    }
    case "INTERNAL": {
      const internalPath = str(record.path, [...path, "path"], SHELL_LIMITS.internalPath, 1);
      if (!isSafeInternalPath(internalPath)) {
        fail([...path, "path"], "Internal paths must be site-relative and must not change the origin");
      }
      return { type: "INTERNAL", path: internalPath };
    }
    case "EXTERNAL": {
      const url = str(record.url, [...path, "url"], SHELL_LIMITS.externalUrl, 1);
      if (!isCredentialFreeHttpsUrl(url)) {
        fail([...path, "url"], "External links must be credential-free HTTPS URLs");
      }
      return { type: "EXTERNAL", url };
    }
    default:
      return fail([...path, "type"], "Unsupported link type");
  }
}

function parseAssetRef(value: unknown, path: string[]): ShellAssetRef {
  if (value === null) return null;
  const record = strict(value, path, ["assetId"]);
  const assetId = str(record.assetId, [...path, "assetId"], 64, 1);
  if (!UUID_RE.test(assetId)) fail([...path, "assetId"], "Expected a UUID");
  return { assetId };
}

function parseHeaderItem(value: unknown, path: string[]): HeaderItem {
  const record = strict(value, path, ["id", "kind", "targetId", "labelOverride", "label", "link", "enabled"]);
  const id = str(record.id, [...path, "id"], 128, 1);
  if (typeof record.enabled !== "boolean") fail([...path, "enabled"], "Expected a boolean");

  if (record.kind === "CATEGORY_ROOT" || record.kind === "COLLECTION") {
    const targetId = str(record.targetId, [...path, "targetId"], 64, 1);
    if (!UUID_RE.test(targetId)) fail([...path, "targetId"], "Expected a UUID");
    return {
      id,
      kind: record.kind,
      targetId,
      labelOverride: str(record.labelOverride, [...path, "labelOverride"], SHELL_LIMITS.label),
      enabled: record.enabled,
    };
  }
  if (record.kind === "STRUCTURED_LINK") {
    return {
      id,
      kind: "STRUCTURED_LINK",
      label: str(record.label, [...path, "label"], SHELL_LIMITS.label),
      link: parseStructuredLink(record.link, [...path, "link"]),
      enabled: record.enabled,
    };
  }
  return fail([...path, "kind"], "Unsupported header item kind");
}

function parseFooterRow(value: unknown, path: string[]): FooterRow {
  const record = strict(value, path, ["id", "kind", "label", "link", "text"]);
  const id = str(record.id, [...path, "id"], 128, 1);
  if (record.kind === "LINK") {
    return {
      id,
      kind: "LINK",
      label: str(record.label, [...path, "label"], SHELL_LIMITS.label),
      link: parseStructuredLink(record.link, [...path, "link"]),
    };
  }
  if (record.kind === "TEXT") {
    return { id, kind: "TEXT", text: str(record.text, [...path, "text"], SHELL_LIMITS.footerText) };
  }
  return fail([...path, "kind"], "Unsupported footer row kind");
}

function parseFooterColumn(value: unknown, path: string[]): FooterColumn {
  const record = strict(value, path, [
    "id",
    "kind",
    "title",
    "rows",
    "supportEmail",
    "supportHours",
    "trackOrderLabel",
    "trackOrderLink",
  ]);
  const id = str(record.id, [...path, "id"], 128, 1);
  const title = str(record.title, [...path, "title"], SHELL_LIMITS.columnTitle);

  if (record.kind === "LINKS") {
    if (!Array.isArray(record.rows)) fail([...path, "rows"], "Expected an array");
    if (record.rows.length > SHELL_LIMITS.maxFooterRows) {
      fail([...path, "rows"], `Expected at most ${SHELL_LIMITS.maxFooterRows} rows`);
    }
    return {
      id,
      kind: "LINKS",
      title,
      rows: record.rows.map((row, index) => parseFooterRow(row, [...path, "rows", String(index)])),
    };
  }
  if (record.kind === "CONTACT") {
    return {
      id,
      kind: "CONTACT",
      title,
      supportEmail: str(record.supportEmail, [...path, "supportEmail"], SHELL_LIMITS.supportEmail),
      supportHours: str(record.supportHours, [...path, "supportHours"], SHELL_LIMITS.supportHours),
      trackOrderLabel: str(record.trackOrderLabel, [...path, "trackOrderLabel"], SHELL_LIMITS.trackOrderLabel),
      trackOrderLink: parseStructuredLink(record.trackOrderLink, [...path, "trackOrderLink"]),
    };
  }
  return fail([...path, "kind"], "Unsupported footer column kind");
}

function parseFooterSocials(value: unknown, path: string[]): FooterSocial[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(path, "Expected an array");
  if (value.length > SHELL_LIMITS.maxFooterSocials) {
    fail(path, `Expected at most ${SHELL_LIMITS.maxFooterSocials} social links`);
  }
  return value.map((entry, index) => {
    const itemPath = [...path, String(index)];
    const record = strict(entry, itemPath, ["id", "network", "url"]);
    const network = record.network;
    if (
      network !== "FACEBOOK" &&
      network !== "INSTAGRAM" &&
      network !== "TIKTOK" &&
      network !== "YOUTUBE"
    ) {
      fail([...itemPath, "network"], "Unsupported social network");
    }
    const url = str(record.url, [...itemPath, "url"], SHELL_LIMITS.externalUrl, 1);
    if (!isCredentialFreeHttpsUrl(url)) {
      fail([...itemPath, "url"], "Social links must be credential-free https URLs");
    }
    return {
      id: str(record.id, [...itemPath, "id"], 128, 1),
      network,
      url,
    };
  });
}

function parseFooterLegal(value: unknown, path: string[]): FooterLegalLink[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(path, "Expected an array");
  if (value.length > SHELL_LIMITS.maxFooterLegal) {
    fail(path, `Expected at most ${SHELL_LIMITS.maxFooterLegal} legal links`);
  }
  return value.map((entry, index) => {
    const itemPath = [...path, String(index)];
    const record = strict(entry, itemPath, ["id", "label", "href"]);
    const href = str(record.href, [...itemPath, "href"], SHELL_LIMITS.internalPath, 1);
    if (!isSafeInternalPath(href) && !isCredentialFreeHttpsUrl(href)) {
      fail([...itemPath, "href"], "Legal links must be internal paths or credential-free https URLs");
    }
    return {
      id: str(record.id, [...itemPath, "id"], 128, 1),
      label: str(record.label, [...itemPath, "label"], SHELL_LIMITS.label),
      href,
    };
  });
}

function parseFooterPayments(value: unknown, path: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(path, "Expected an array");
  if (value.length > SHELL_LIMITS.maxFooterPayments) {
    fail(path, `Expected at most ${SHELL_LIMITS.maxFooterPayments} payment labels`);
  }
  return value.map((entry, index) =>
    str(entry, [...path, String(index)], SHELL_LIMITS.paymentLabel, 1),
  );
}

function parseTheme(value: unknown, path: string[]): StorefrontThemeSource {
  const record = strict(value, path, [
    "primary",
    "action",
    "background",
    "surface",
    "text",
    "headingFont",
    "bodyFont",
  ]);
  const headingFont = record.headingFont;
  if (headingFont !== "SYSTEM" && headingFont !== "POPPINS_HEADING" && headingFont !== "SERIF_HEADING") {
    fail([...path, "headingFont"], "Unsupported heading font preset");
  }
  if (record.bodyFont !== "SYSTEM") fail([...path, "bodyFont"], "Unsupported body font preset");

  return {
    primary: hex(record.primary, [...path, "primary"]),
    action: hex(record.action, [...path, "action"]),
    background: hex(record.background, [...path, "background"]),
    surface: hex(record.surface, [...path, "surface"]),
    text: hex(record.text, [...path, "text"]),
    headingFont,
    bodyFont: "SYSTEM",
  };
}

/** Mirrors the backend `storefrontShellDocumentSchema`. */
export function storefrontShellDocumentSchemaParse(input: unknown): ShellDocumentParseResult {
  try {
    const record = strict(input, [], ["schemaVersion", "brand", "header", "footer", "theme"]);
    if (record.schemaVersion !== STOREFRONT_SHELL_SCHEMA_VERSION) {
      fail(["schemaVersion"], `Expected schemaVersion ${STOREFRONT_SHELL_SCHEMA_VERSION}`);
    }

    const brandRecord = strict(record.brand, ["brand"], ["brandName", "horizontalLogo", "squareMark"]);
    const headerRecord = strict(record.header, ["header"], ["items"]);
    if (!Array.isArray(headerRecord.items)) fail(["header", "items"], "Expected an array");
    if (headerRecord.items.length > SHELL_LIMITS.maxHeaderRows) {
      fail(["header", "items"], `Expected at most ${SHELL_LIMITS.maxHeaderRows} items`);
    }

    const footerRecord = strict(record.footer, ["footer"], [
      "tagline",
      "description",
      "columns",
      "copyrightBrand",
      "socials",
      "legal",
      "payments",
    ]);
    if (!Array.isArray(footerRecord.columns)) fail(["footer", "columns"], "Expected an array");
    if (footerRecord.columns.length > SHELL_LIMITS.maxFooterColumns) {
      fail(["footer", "columns"], `Expected at most ${SHELL_LIMITS.maxFooterColumns} columns`);
    }

    const data: StorefrontShellDocument = {
      schemaVersion: STOREFRONT_SHELL_SCHEMA_VERSION,
      brand: {
        brandName: str(brandRecord.brandName, ["brand", "brandName"], SHELL_LIMITS.brandName),
        horizontalLogo: parseAssetRef(brandRecord.horizontalLogo, ["brand", "horizontalLogo"]),
        squareMark: parseAssetRef(brandRecord.squareMark, ["brand", "squareMark"]),
      },
      header: {
        items: headerRecord.items.map((item, index) => parseHeaderItem(item, ["header", "items", String(index)])),
      },
      footer: {
        tagline: str(footerRecord.tagline, ["footer", "tagline"], SHELL_LIMITS.tagline),
        description: str(footerRecord.description, ["footer", "description"], SHELL_LIMITS.description),
        columns: footerRecord.columns.map((column, index) =>
          parseFooterColumn(column, ["footer", "columns", String(index)]),
        ),
        copyrightBrand: str(footerRecord.copyrightBrand, ["footer", "copyrightBrand"], SHELL_LIMITS.brandName),
        socials: parseFooterSocials(footerRecord.socials, ["footer", "socials"]),
        legal: parseFooterLegal(footerRecord.legal, ["footer", "legal"]),
        payments: parseFooterPayments(footerRecord.payments, ["footer", "payments"]),
      },
      theme: parseTheme(record.theme, ["theme"]),
    };

    return { success: true, data };
  } catch (error) {
    if (error instanceof PathError) {
      return { success: false, error: { issues: [{ path: error.path, message: error.message }] } };
    }
    throw error;
  }
}

/** Shape-parses then re-emits. Never caps silently, reorders, or invents ids. */
export function normalizeStorefrontShellDocument(input: unknown): StorefrontShellDocument {
  const parsed = storefrontShellDocumentSchemaParse(input);
  if (!parsed.success) {
    throw new Error(
      `Invalid storefront shell document at ${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`,
    );
  }
  return parsed.data;
}

export const CURRENT_LUWAG_THEME_SOURCE: StorefrontThemeSource = {
  primary: "#c9a77b",
  action: "#244c3c",
  background: "#faf8f5",
  surface: "#ffffff",
  text: "#1f2a24",
  headingFont: "SYSTEM",
  bodyFont: "SYSTEM",
};

const LEGACY_FLAT_LINKS = [
  { label: "New Arrivals", slug: "new-arrivals", position: 0 },
  { label: "Solutions", slug: "small-space-solutions", position: 50 },
  { label: "Best Sellers", slug: "best-sellers", position: 60 },
] as const;

/** Frontend mirror of the backend factory; used by editor defaults and tests. */
/** Policy pages every fresh document ships in the Help column. */
const POLICY_HELP_ROWS: FooterRow[] = [
  {
    id: "00000000-0000-7000-8000-000000000231",
    kind: "LINK",
    label: "Shipping & Delivery",
    link: { type: "INTERNAL", path: "/shipping-delivery" },
  },
  {
    id: "00000000-0000-7000-8000-000000000232",
    kind: "LINK",
    label: "Returns & Refunds",
    link: { type: "INTERNAL", path: "/returns-refunds" },
  },
  {
    id: "00000000-0000-7000-8000-000000000233",
    kind: "LINK",
    label: "Contact Us",
    link: { type: "INTERNAL", path: "/contact" },
  },
  {
    id: "00000000-0000-7000-8000-000000000234",
    kind: "LINK",
    label: "Terms of Service",
    link: { type: "INTERNAL", path: "/terms" },
  },
];

/** The bottom-row policy links; the Footer itself also injects Privacy. */
const POLICY_LEGAL_LINKS: FooterLegalLink[] = [
  {
    id: "00000000-0000-7000-8000-000000000241",
    label: "Privacy Policy",
    href: "/privacy",
  },
  {
    id: "00000000-0000-7000-8000-000000000242",
    label: "Returns & Refunds",
    href: "/returns-refunds",
  },
  {
    id: "00000000-0000-7000-8000-000000000243",
    label: "Terms of Service",
    href: "/terms",
  },
];

export function createCurrentLuwagShellDocument(
  input: CurrentLuwagShellSeedInput,
): StorefrontShellDocument {
  const bySlug = new Map(input.navigationCollections.map((collection) => [collection.slug, collection]));
  const positioned: Array<{ position: number; item: HeaderItem }> = [];

  for (const flat of LEGACY_FLAT_LINKS) {
    const collection = bySlug.get(flat.slug);
    if (!collection) continue;
    positioned.push({
      position: flat.position,
      item: {
        id: collection.id,
        kind: "STRUCTURED_LINK",
        label: flat.label,
        enabled: true,
        link: { type: "COLLECTION", id: collection.id },
      },
    });
  }
  input.rootCategories.forEach((root, index) => {
    positioned.push({
      position: (index + 1) * 10,
      item: {
        id: root.id,
        kind: "CATEGORY_ROOT",
        targetId: root.id,
        labelOverride: root.name,
        enabled: true,
      },
    });
  });
  positioned.sort((a, b) => a.position - b.position);

  const shopRows: FooterRow[] = input.navigationCollections
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((collection) => ({
      id: collection.id,
      kind: "LINK",
      label: collection.name,
      link: { type: "COLLECTION", id: collection.id },
    }));

  const columns: FooterColumn[] = [
    { id: "00000000-0000-7000-8000-000000000210", kind: "LINKS", title: "Shop", rows: shopRows },
    {
      id: "00000000-0000-7000-8000-000000000230",
      kind: "LINKS",
      title: "Help",
      rows: POLICY_HELP_ROWS,
    },
    {
      id: "00000000-0000-7000-8000-000000000220",
      kind: "CONTACT",
      title: "Contact",
      supportEmail: input.supportEmail,
      supportHours: input.supportHours,
      trackOrderLabel: "Track Order",
      trackOrderLink: { type: "INTERNAL", path: "/track-order" },
    },
  ];

  return normalizeStorefrontShellDocument({
    schemaVersion: STOREFRONT_SHELL_SCHEMA_VERSION,
    brand: { brandName: "LUWAG", horizontalLogo: null, squareMark: null },
    header: { items: positioned.map((entry) => entry.item) },
    footer: {
      tagline: "Small-space furniture, made roomy",
      description: "Furniture for Filipino condos and rentals. Cash on delivery, nationwide.",
      columns,
      copyrightBrand: "LUWAG Living",
      legal: POLICY_LEGAL_LINKS,
    },
    theme: CURRENT_LUWAG_THEME_SOURCE,
  });
}
