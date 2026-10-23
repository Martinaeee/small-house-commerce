import {
  adminAuthedFetch,
  adminAuthedFetchOnce,
} from "./admin-auth";
import {
  normalizeStorefrontShellDocument,
  type DerivedStorefrontTheme,
  type ShellIssue,
  type StorefrontShellDocument,
  type StorefrontThemeSource,
} from "./storefront-shell-document";

const BASE = "/api/v1/admin/storefront-shell";
const HEX = /^#[0-9a-f]{6}$/;

export type AdminShellAsset = {
  id: string;
  kind: "HORIZONTAL" | "SQUARE";
  url: string;
  mimeType: "image/png" | "image/webp";
  width: number;
  height: number;
  durable: boolean;
  createdAt: string;
};

export type AdminShellSnapshot = {
  document: StorefrontShellDocument;
  version: number;
  publishedRevision: number;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  publishedAt: string | null;
  issues: ShellIssue[];
  assets: Record<string, AdminShellAsset>;
};

export type AdminShellValidationResult = {
  version: number;
  issues: ShellIssue[];
  derivedTheme: DerivedStorefrontTheme;
};

export type ResolvedFooterView = {
  tagline: string;
  description: string;
  columns: Array<
    | {
        id: string;
        kind: "LINKS";
        title: string;
        rows: Array<
          | { id: string; kind: "LINK"; label: string; href: string }
          | { id: string; kind: "TEXT"; text: string }
        >;
      }
    | {
        id: string;
        kind: "CONTACT";
        title: string;
        supportEmail: string;
        supportHours: string;
        codText: string;
        trackOrderLabel: string;
        trackOrderHref: string | null;
      }
  >;
  copyrightBrand: string;
  socials: Array<{
    id: string;
    network: "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "YOUTUBE";
    href: string;
  }>;
  legal: Array<{ id: string; label: string; href: string }>;
  payments: string[];
};

export type PublicStorefrontShell = {
  publishedRevision: number;
  brand: {
    brandName: string;
    horizontalLogo: PublicBrandAsset | null;
    squareMark: PublicBrandAsset | null;
  };
  header: {
    items: Array<
      | { id: string; kind: "CATEGORY_ROOT"; categoryId: string; label: string }
      | { id: string; kind: "LINK"; label: string; href: string }
    >;
  };
  footer: ResolvedFooterView;
  theme: StorefrontThemeSource;
  derivedTheme: DerivedStorefrontTheme;
};

export type AdminShellUploadResult = {
  version: number;
  issues: ShellIssue[];
  asset: AdminShellAsset;
};

export type AdminShellPreviewResult = {
  version: number;
  issues: ShellIssue[];
  shell: PublicStorefrontShell;
};

type PublicBrandAsset = {
  id: string;
  url: string;
  width: number;
  height: number;
};

type JsonRecord = Record<string, unknown>;

function exact(
  value: unknown,
  path: string,
  keys: readonly string[],
): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const result = value as JsonRecord;
  const allowed = new Set(keys);
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is unexpected`);
  }
  for (const key of keys) {
    if (!(key in result)) throw new Error(`${path}.${key} is required`);
  }
  return result;
}

/**
 * Same rules as `exact`, but the optional keys may be missing: the public
 * shell grew the footer extras later, and an older cached payload must still
 * render (the missing arrays simply mean "nothing configured").
 */
function exactWithOptional(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const result = value as JsonRecord;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is unexpected`);
  }
  for (const key of required) {
    if (!(key in result)) throw new Error(`${path}.${key} is required`);
  }
  return result;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function integer(value: unknown, path: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${path} must be an integer >= ${minimum}`);
  }
  return value as number;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function parseIssue(value: unknown, path: string): ShellIssue {
  const source = exactRecord(value, path);
  const allowed = new Set([
    "code",
    "path",
    "message",
    "itemId",
    "ratio",
    "requiredRatio",
  ]);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is unexpected`);
  }
  const parsed: ShellIssue = {
    code: stringValue(source.code, `${path}.code`),
    path: array(source.path, `${path}.path`).map((entry, index) =>
      stringValue(entry, `${path}.path.${index}`),
    ),
    message: stringValue(source.message, `${path}.message`),
  };
  if (source.itemId !== undefined) {
    parsed.itemId = stringValue(source.itemId, `${path}.itemId`);
  }
  if (source.ratio !== undefined) {
    if (typeof source.ratio !== "number" || !Number.isFinite(source.ratio)) {
      throw new Error(`${path}.ratio must be a finite number`);
    }
    parsed.ratio = source.ratio;
  }
  if (source.requiredRatio !== undefined) {
    if (
      typeof source.requiredRatio !== "number" ||
      !Number.isFinite(source.requiredRatio)
    ) {
      throw new Error(`${path}.requiredRatio must be a finite number`);
    }
    parsed.requiredRatio = source.requiredRatio;
  }
  return parsed;
}

function parseIssues(value: unknown, path: string): ShellIssue[] {
  return array(value, path).map((entry, index) =>
    parseIssue(entry, `${path}.${index}`),
  );
}

function hex(value: unknown, path: string): string {
  const parsed = stringValue(value, path);
  if (!HEX.test(parsed)) throw new Error(`${path} must be a six-digit hex color`);
  return parsed;
}

function parseDerivedTheme(value: unknown, path: string): DerivedStorefrontTheme {
  const keys = [
    "primaryDark",
    "primaryLight",
    "actionHover",
    "textSecondary",
    "textMuted",
    "border",
    "focus",
    "disabled",
    "actionForeground",
  ] as const;
  const source = exact(value, path, keys);
  return {
    primaryDark: hex(source.primaryDark, `${path}.primaryDark`),
    primaryLight: hex(source.primaryLight, `${path}.primaryLight`),
    actionHover: hex(source.actionHover, `${path}.actionHover`),
    textSecondary: hex(source.textSecondary, `${path}.textSecondary`),
    textMuted: hex(source.textMuted, `${path}.textMuted`),
    border: hex(source.border, `${path}.border`),
    focus: hex(source.focus, `${path}.focus`),
    disabled: hex(source.disabled, `${path}.disabled`),
    actionForeground: hex(source.actionForeground, `${path}.actionForeground`),
  };
}

function parseTheme(value: unknown, path: string): StorefrontThemeSource {
  const source = exact(value, path, [
    "primary",
    "action",
    "background",
    "surface",
    "text",
    "headingFont",
    "bodyFont",
  ]);
  const headingFont = stringValue(source.headingFont, `${path}.headingFont`);
  const bodyFont = stringValue(source.bodyFont, `${path}.bodyFont`);
  if (!["SYSTEM", "POPPINS_HEADING", "SERIF_HEADING"].includes(headingFont)) {
    throw new Error(`${path}.headingFont is invalid`);
  }
  if (bodyFont !== "SYSTEM") throw new Error(`${path}.bodyFont is invalid`);
  return {
    primary: hex(source.primary, `${path}.primary`),
    action: hex(source.action, `${path}.action`),
    background: hex(source.background, `${path}.background`),
    surface: hex(source.surface, `${path}.surface`),
    text: hex(source.text, `${path}.text`),
    headingFont: headingFont as StorefrontThemeSource["headingFont"],
    bodyFont: "SYSTEM",
  };
}

function parseAdminAsset(value: unknown, path: string): AdminShellAsset {
  const source = exact(value, path, [
    "id",
    "kind",
    "url",
    "mimeType",
    "width",
    "height",
    "durable",
    "createdAt",
  ]);
  const kind = stringValue(source.kind, `${path}.kind`);
  const mimeType = stringValue(source.mimeType, `${path}.mimeType`);
  if (kind !== "HORIZONTAL" && kind !== "SQUARE") {
    throw new Error(`${path}.kind is invalid`);
  }
  if (mimeType !== "image/png" && mimeType !== "image/webp") {
    throw new Error(`${path}.mimeType is invalid`);
  }
  return {
    id: stringValue(source.id, `${path}.id`),
    kind,
    url: stringValue(source.url, `${path}.url`),
    mimeType,
    width: integer(source.width, `${path}.width`, 1),
    height: integer(source.height, `${path}.height`, 1),
    durable: booleanValue(source.durable, `${path}.durable`),
    createdAt: stringValue(source.createdAt, `${path}.createdAt`),
  };
}

function parsePublicAsset(value: unknown, path: string): PublicBrandAsset | null {
  if (value === null) return null;
  const source = exact(value, path, ["id", "url", "width", "height"]);
  return {
    id: stringValue(source.id, `${path}.id`),
    url: stringValue(source.url, `${path}.url`),
    width: integer(source.width, `${path}.width`, 1),
    height: integer(source.height, `${path}.height`, 1),
  };
}

export function parseAdminShellSnapshot(value: unknown): AdminShellSnapshot {
  const source = exact(value, "shell", [
    "document",
    "version",
    "publishedRevision",
    "hasUnpublishedChanges",
    "updatedAt",
    "publishedAt",
    "issues",
    "assets",
  ]);
  const assetsSource = exactRecord(source.assets, "shell.assets");
  const assets: Record<string, AdminShellAsset> = {};
  for (const [id, entry] of Object.entries(assetsSource)) {
    assets[id] = parseAdminAsset(entry, `shell.assets.${id}`);
  }
  return {
    document: normalizeStorefrontShellDocument(source.document),
    version: integer(source.version, "shell.version", 1),
    publishedRevision: integer(
      source.publishedRevision,
      "shell.publishedRevision",
      0,
    ),
    hasUnpublishedChanges: booleanValue(
      source.hasUnpublishedChanges,
      "shell.hasUnpublishedChanges",
    ),
    updatedAt: stringValue(source.updatedAt, "shell.updatedAt"),
    publishedAt:
      source.publishedAt === null
        ? null
        : stringValue(source.publishedAt, "shell.publishedAt"),
    issues: parseIssues(source.issues, "shell.issues"),
    assets,
  };
}

function exactRecord(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as JsonRecord;
}

export function parseAdminShellValidationResult(
  value: unknown,
): AdminShellValidationResult {
  const source = exact(value, "validation", ["version", "issues", "derivedTheme"]);
  return {
    version: integer(source.version, "validation.version", 1),
    issues: parseIssues(source.issues, "validation.issues"),
    derivedTheme: parseDerivedTheme(
      source.derivedTheme,
      "validation.derivedTheme",
    ),
  };
}

export function parsePublicStorefrontShell(value: unknown): PublicStorefrontShell {
  const source = exact(value, "publicShell", [
    "publishedRevision",
    "brand",
    "header",
    "footer",
    "theme",
    "derivedTheme",
  ]);
  const brand = exact(source.brand, "publicShell.brand", [
    "brandName",
    "horizontalLogo",
    "squareMark",
  ]);
  const header = exact(source.header, "publicShell.header", ["items"]);
  const footer = exactWithOptional(
    source.footer,
    "publicShell.footer",
    ["tagline", "description", "columns", "copyrightBrand"],
    ["socials", "legal", "payments"],
  );

  return {
    publishedRevision: integer(
      source.publishedRevision,
      "publicShell.publishedRevision",
      0,
    ),
    brand: {
      brandName: stringValue(brand.brandName, "publicShell.brand.brandName"),
      horizontalLogo: parsePublicAsset(
        brand.horizontalLogo,
        "publicShell.brand.horizontalLogo",
      ),
      squareMark: parsePublicAsset(
        brand.squareMark,
        "publicShell.brand.squareMark",
      ),
    },
    header: {
      items: array(header.items, "publicShell.header.items").map((entry, index) =>
        parseHeaderItem(entry, `publicShell.header.items.${index}`),
      ),
    },
    footer: {
      tagline: stringValue(footer.tagline, "publicShell.footer.tagline"),
      description: stringValue(
        footer.description,
        "publicShell.footer.description",
      ),
      columns: array(footer.columns, "publicShell.footer.columns").map(
        (entry, index) =>
          parseFooterColumn(entry, `publicShell.footer.columns.${index}`),
      ),
      copyrightBrand: stringValue(
        footer.copyrightBrand,
        "publicShell.footer.copyrightBrand",
      ),
      socials:
        footer.socials === undefined
          ? []
          : array(footer.socials, "publicShell.footer.socials").map(
              (entry, index) =>
                parseFooterSocial(entry, `publicShell.footer.socials.${index}`),
            ),
      legal:
        footer.legal === undefined
          ? []
          : array(footer.legal, "publicShell.footer.legal").map(
              (entry, index) =>
                parseFooterLegal(entry, `publicShell.footer.legal.${index}`),
            ),
      payments:
        footer.payments === undefined
          ? []
          : array(footer.payments, "publicShell.footer.payments").map(
              (entry, index) =>
                stringValue(entry, `publicShell.footer.payments.${index}`),
            ),
    },
    theme: parseTheme(source.theme, "publicShell.theme"),
    derivedTheme: parseDerivedTheme(
      source.derivedTheme,
      "publicShell.derivedTheme",
    ),
  };
}

function parseHeaderItem(
  value: unknown,
  path: string,
): PublicStorefrontShell["header"]["items"][number] {
  const base = exactRecord(value, path);
  const kind = stringValue(base.kind, `${path}.kind`);
  if (kind === "CATEGORY_ROOT") {
    const source = exact(value, path, ["id", "kind", "categoryId", "label"]);
    return {
      id: stringValue(source.id, `${path}.id`),
      kind,
      categoryId: stringValue(source.categoryId, `${path}.categoryId`),
      label: stringValue(source.label, `${path}.label`),
    };
  }
  if (kind === "LINK") {
    const source = exact(value, path, ["id", "kind", "label", "href"]);
    return {
      id: stringValue(source.id, `${path}.id`),
      kind,
      label: stringValue(source.label, `${path}.label`),
      href: stringValue(source.href, `${path}.href`),
    };
  }
  throw new Error(`${path}.kind is invalid`);
}

function parseFooterSocial(
  value: unknown,
  path: string,
): ResolvedFooterView["socials"][number] {
  const record = exactRecord(value, path);
  const network = stringValue(record.network, `${path}.network`);
  if (
    network !== "FACEBOOK" &&
    network !== "INSTAGRAM" &&
    network !== "TIKTOK" &&
    network !== "YOUTUBE"
  ) {
    throw new Error(`${path}.network is not a supported network`);
  }
  return {
    id: stringValue(record.id, `${path}.id`),
    network,
    href: stringValue(record.href, `${path}.href`),
  };
}

function parseFooterLegal(
  value: unknown,
  path: string,
): ResolvedFooterView["legal"][number] {
  const record = exactRecord(value, path);
  return {
    id: stringValue(record.id, `${path}.id`),
    label: stringValue(record.label, `${path}.label`),
    href: stringValue(record.href, `${path}.href`),
  };
}

function parseFooterColumn(
  value: unknown,
  path: string,
): ResolvedFooterView["columns"][number] {
  const base = exactRecord(value, path);
  const kind = stringValue(base.kind, `${path}.kind`);
  if (kind === "LINKS") {
    const source = exact(value, path, ["id", "kind", "title", "rows"]);
    return {
      id: stringValue(source.id, `${path}.id`),
      kind,
      title: stringValue(source.title, `${path}.title`),
      rows: array(source.rows, `${path}.rows`).map((entry, index) =>
        parseFooterRow(entry, `${path}.rows.${index}`),
      ),
    };
  }
  if (kind === "CONTACT") {
    const source = exact(value, path, [
      "id",
      "kind",
      "title",
      "supportEmail",
      "supportHours",
      "codText",
      "trackOrderLabel",
      "trackOrderHref",
    ]);
    return {
      id: stringValue(source.id, `${path}.id`),
      kind,
      title: stringValue(source.title, `${path}.title`),
      supportEmail: stringValue(source.supportEmail, `${path}.supportEmail`),
      supportHours: stringValue(source.supportHours, `${path}.supportHours`),
      codText: stringValue(source.codText, `${path}.codText`),
      trackOrderLabel: stringValue(
        source.trackOrderLabel,
        `${path}.trackOrderLabel`,
      ),
      trackOrderHref:
        source.trackOrderHref === null
          ? null
          : stringValue(source.trackOrderHref, `${path}.trackOrderHref`),
    };
  }
  throw new Error(`${path}.kind is invalid`);
}

function parseFooterRow(
  value: unknown,
  path: string,
): Extract<ResolvedFooterView["columns"][number], { kind: "LINKS" }>["rows"][number] {
  const base = exactRecord(value, path);
  const kind = stringValue(base.kind, `${path}.kind`);
  if (kind === "LINK") {
    const source = exact(value, path, ["id", "kind", "label", "href"]);
    return {
      id: stringValue(source.id, `${path}.id`),
      kind,
      label: stringValue(source.label, `${path}.label`),
      href: stringValue(source.href, `${path}.href`),
    };
  }
  if (kind === "TEXT") {
    const source = exact(value, path, ["id", "kind", "text"]);
    return {
      id: stringValue(source.id, `${path}.id`),
      kind,
      text: stringValue(source.text, `${path}.text`),
    };
  }
  throw new Error(`${path}.kind is invalid`);
}

export function parseAdminShellUploadResult(
  value: unknown,
): AdminShellUploadResult {
  const source = exact(value, "upload", ["version", "issues", "asset"]);
  return {
    version: integer(source.version, "upload.version", 1),
    issues: parseIssues(source.issues, "upload.issues"),
    asset: parseAdminAsset(source.asset, "upload.asset"),
  };
}

export function parseAdminShellPreviewResult(
  value: unknown,
): AdminShellPreviewResult {
  const source = exact(value, "preview", ["version", "issues", "shell"]);
  return {
    version: integer(source.version, "preview.version", 1),
    issues: parseIssues(source.issues, "preview.issues"),
    shell: parsePublicStorefrontShell(source.shell),
  };
}

export const storefrontShellApi = {
  async get(): Promise<AdminShellSnapshot> {
    return parseAdminShellSnapshot(await adminAuthedFetch<unknown>(BASE));
  },

  async save(
    document: StorefrontShellDocument,
    expectedVersion: number,
  ): Promise<AdminShellSnapshot> {
    const response = await adminAuthedFetch<unknown>(BASE, {
      method: "PATCH",
      body: JSON.stringify({ document, expectedVersion }),
    });
    return parseAdminShellSnapshot(response);
  },

  async validate(
    document: StorefrontShellDocument,
  ): Promise<AdminShellValidationResult> {
    const response = await adminAuthedFetch<unknown>(`${BASE}/validate`, {
      method: "POST",
      body: JSON.stringify(document),
    });
    return parseAdminShellValidationResult(response);
  },

  async publish(expectedVersion: number): Promise<AdminShellSnapshot> {
    const response = await adminAuthedFetchOnce<unknown>(`${BASE}/publish`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    });
    return parseAdminShellSnapshot(response);
  },

  async upload(
    file: File,
    slot: "horizontal" | "square",
  ): Promise<AdminShellUploadResult> {
    const response = await adminAuthedFetchOnce<unknown>(
      `${BASE}/upload?slot=${encodeURIComponent(slot)}`,
      {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      },
    );
    return parseAdminShellUploadResult(response);
  },

  async preview(): Promise<AdminShellPreviewResult> {
    return parseAdminShellPreviewResult(
      await adminAuthedFetch<unknown>(`${BASE}/preview`),
    );
  },
};
