import {
  request as playwrightRequest,
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { assertE2EDatabaseUrl } from "../src/lib/e2e-guard";

/**
 * Task 5 — real-browser acceptance for the admin product editor.
 *
 * Runs against the SAME guarded stack as variant-options-media.spec.ts: the
 * worktree backend (:3210) + storefront frontend (:3211) pointed at the
 * disposable `small_house_variant_test` database that e2e/global-setup.ts
 * migrates and seeds. Nothing here may touch production: the first test pins
 * the loopback origins AND proves the database behind them holds nothing but
 * the seeded `e2e-*` scenarios.
 *
 * Evidence rules (task brief):
 *   - assert DOM, URL/network and BACKEND API state — screenshots are only
 *     supplemental;
 *   - reads after a save go straight to the backend API, because the Next 16
 *     dev rewrite proxy can answer with a stale cached body;
 *   - every mutated fixture is restored in `finally`, so a failed assertion
 *     cannot leave the next run dirty.
 *
 * Budget note: POST /auth/login is throttled to 10 requests / 10 minutes per
 * IP (auth.controller.ts), so this file logs in through the browser ONCE per
 * scenario (8 in total including the one direct API login) instead of once per
 * assertion group. Restarting the backend resets the in-process window.
 */

const API = "http://127.0.0.1:3210/api/v1";
const CONFIGURED_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.E2E_PG_USER ?? "postgres"}:${process.env.E2E_PG_PASSWORD ?? "postgres"}@localhost:5432/${process.env.E2E_TEST_DB ?? "small_house_variant_test"}?schema=public`;

const E2E_ADMIN_EMAIL = "e2e-admin@smallhouse.test";
const E2E_ADMIN_PASSWORD = "E2eAdminPass123!";

const COLOR_SIZE_SLUG = "e2e-color-size";
const SEEDED_SLUGS = [
  "e2e-color-only",
  "e2e-color-size",
  "e2e-exact-override",
  "e2e-legacy-style",
  "e2e-size-only",
];

/** Existing seeded SVG assets: reusing them keeps every thumbnail a 200. */
const VALUE_MEDIA_URL = "/uploads/e2e/exact-override-red.svg";
const VARIANT_MEDIA_URL = "/uploads/e2e/e2e-exact-override-blue.svg";
const THUMBNAIL_URL = "/uploads/e2e/size-only-shared-1.svg";
const RED_VALUE_URL = "/uploads/e2e/e2e-color-size-red.svg";
const BLUE_VALUE_URL = "/uploads/e2e/e2e-color-size-blue.svg";

/** Migrated editor labels — asserted verbatim, so a zh+en concatenation fails. */
const ZH = {
  tabs: {
    basic: "基本信息",
    media: "商品媒体",
    variants: "选项、价格与库存",
    specs: "商品规格",
    shipping: "包装与物流",
    seo: "搜索与链接",
    preview: "预览",
  },
  tabsAria: "商品表单分区",
  saveChanges: "保存更改",
  saveDraft: "保存草稿",
  saved: "商品已保存。",
  statusDraft: "草稿",
  statusActive: "上架",
  statusDisabled: "下架",
  driverSelect: "切换商品图库的选项",
  targetVariant: "目标款式",
  addVariantMedia: "添加款式媒体",
  addValueMedia: (name: string) => `为 ${name} 添加媒体`,
  removeMedia: "移除媒体",
  exactTitle: "精确款式媒体",
  inactiveTitle: "未启用的选项值作用域",
  inactiveSource: (option: string, value: string) => `来源：${option} / ${value}`,
  noValueMedia: "还没有专属媒体；前台回退到共享图库。",
  sharedGallery: "共享商品图库",
  presentation: "选项 1 展示样式",
  thumbnail: "缩略图 Red",
  thumbnailLabel: "选择按钮小图（可选）",
  presentationSwatch: "色块",
  presentationImage: "图片选择按钮",
  savedActiveNote: "已保存的上架页面仍然在线，即使当前改动未保存。",
  unsavedNote: "当前表单改动尚未保存；前台仍使用已保存版本。",
  newProductNote: "这是新商品，尚未保存，不会请求或打开前台商品页。",
  inactiveSavedNote: "已保存版本目前未上架，不会请求或打开前台商品页。",
  openSaved: "打开已保存的前台页面",
  refreshPreview: "刷新预览",
  newTitle: "新建商品",
  typedVariantsTitle: "选项与款式",
};

const EN = {
  tabs: {
    basic: "Basic Info",
    media: "Media",
    variants: "Options, Pricing & Inventory",
    specs: "Specifications",
    shipping: "Shipping",
    seo: "SEO & Links",
    preview: "Preview",
  },
  tabsAria: "Product form sections",
  saveChanges: "Save changes",
  statusDraft: "Draft",
  statusActive: "Active",
  statusDisabled: "Disabled",
  sharedGallery: "Shared product gallery",
  typedVariantsTitle: "Options & Variants",
};

const TAB_KEYS = ["basic", "media", "variants", "specs", "shipping", "seo", "preview"] as const;
type TabKey = (typeof TAB_KEYS)[number];

// --- backend API types (admin GET /admin/products/:id) -----------------------

interface GraphMediaRow {
  id: string;
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  sortOrder: number;
  optionValueId: string | null;
  variantId: string | null;
}

interface GraphOptionValue {
  id: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isActive: boolean;
}

interface GraphOption {
  id: string;
  kind: string;
  name: string;
  position: number;
  presentation: string;
  isMediaDriver: boolean;
  isActive: boolean;
  values: GraphOptionValue[];
}

interface GraphSku {
  id: string;
  skuCode: string;
  status: string;
  supplierId: string | null;
  supplierSku: string | null;
  supplierCost: string | null;
  costCurrency: string | null;
  landedCost: string | null;
  price: string | null;
  compareAtPrice: string | null;
  productWeight: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
  packageDepth: number | null;
  packageWeight: number | null;
  volumetricWeight: number | null;
}

interface GraphVariant {
  id: string;
  name: string;
  position: number;
  combinationKey: string | null;
  optionValues?: { optionId: string; optionValueId: string }[];
  sku: GraphSku | null;
}

interface AdminProductJson {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  categoryId?: string;
  status: "DRAFT" | "ACTIVE" | "DISABLED";
  catalogGraphVersion: number;
  options?: GraphOption[];
  media?: GraphMediaRow[];
  variants: GraphVariant[];
}

// --- admin API helpers (direct backend calls) --------------------------------

let adminToken: string | null = null;
/** Captured from the same cached login so a test can seed a session without
 * spending one of the ten admin-login slots per ten minutes. */
let adminRefreshToken: string | null = null;

async function withAdminToken<T>(
  run: (
    token: string,
    context: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  ) => Promise<T>,
): Promise<T> {
  const context = await playwrightRequest.newContext();
  try {
    if (adminToken === null) {
      const login = await context.post(`${API}/auth/login`, {
        data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
      });
      expect(
        login.ok(),
        `admin API login (${login.status()} — the login throttle is 10/10min per IP)`,
      ).toBeTruthy();
      const body = (await login.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      adminToken = body.accessToken;
      adminRefreshToken = body.refreshToken;
    }
    return await run(adminToken, context);
  } finally {
    await context.dispose();
  }
}

async function adminProductIdFor(slug: string): Promise<string> {
  return withAdminToken(async (token, context) => {
    const response = await context.get(`${API}/admin/products?search=${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), "admin product lookup").toBeTruthy();
    const page = (await response.json()) as { items: { id: string; slug: string }[] };
    const found = page.items.find((item) => item.slug === slug);
    expect(found, `seeded product ${slug} exists`).toBeTruthy();
    return found!.id;
  });
}

/** Server truth for one product, read from the BACKEND (never the dev proxy). */
async function adminProduct(slug: string): Promise<AdminProductJson> {
  const id = await adminProductIdFor(slug);
  return withAdminToken(async (token, context) => {
    const response = await context.get(`${API}/admin/products/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), "admin product GET").toBeTruthy();
    return (await response.json()) as AdminProductJson;
  });
}

async function adminPatch(
  productId: string,
  body: Record<string, unknown>,
): Promise<void> {
  await withAdminToken(async (token, context) => {
    const response = await context.patch(`${API}/admin/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: body,
    });
    expect(
      response.ok(),
      `admin product PATCH (${response.status()}): ${await response.text()}`,
    ).toBeTruthy();
  });
}

async function adminCreate(body: Record<string, unknown>): Promise<AdminProductJson> {
  return withAdminToken(async (token, context) => {
    const response = await context.post(`${API}/admin/products`, {
      headers: { Authorization: `Bearer ${token}` },
      data: body,
    });
    expect(
      response.ok(),
      `admin product POST (${response.status()}): ${await response.text()}`,
    ).toBeTruthy();
    return (await response.json()) as AdminProductJson;
  });
}

async function adminDelete(productId: string): Promise<void> {
  await withAdminToken(async (token, context) => {
    const response = await context.delete(`${API}/admin/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 404 = already gone (the create may have failed before the row existed).
    expect([200, 204, 404]).toContain(response.status());
  });
}

/** `value:<id>|url` / `variant:<id>|url` / `shared|url`, sorted. */
function scopeSignature(product: AdminProductJson): string[] {
  return (product.media ?? [])
    .map((row) => {
      const scope = row.optionValueId
        ? `value:${row.optionValueId}`
        : row.variantId
          ? `variant:${row.variantId}`
          : "shared";
      return `${scope}|${row.url}`;
    })
    .sort();
}

function optionByName(product: AdminProductJson, name: string): GraphOption {
  const option = (product.options ?? []).find((row) => row.name === name);
  expect(option, `option ${name} exists`).toBeTruthy();
  return option!;
}

function valueByLabel(option: GraphOption, label: string): GraphOptionValue {
  const value = option.values.find((row) => row.label === label);
  expect(value, `option value ${label} exists`).toBeTruthy();
  return value!;
}

function variantByName(product: AdminProductJson, name: string): GraphVariant {
  const variant = product.variants.find((row) => row.name === name);
  expect(variant, `variant ${name} exists`).toBeTruthy();
  return variant!;
}

/**
 * Normal editor-save invariant: persisted IDs and exact scope references must
 * remain stable when the backend updates existing rows in place.
 */
function persistedIdentityState(product: AdminProductJson): string {
  return JSON.stringify({
    product: { id: product.id, slug: product.slug },
    options: (product.options ?? []).map((option) => ({
      id: option.id,
      values: option.values.map((value) => ({ id: value.id })),
    })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      optionValues: variant.optionValues ?? [],
      skuId: variant.sku?.id ?? null,
    })),
    media: (product.media ?? []).map((row) => ({
      id: row.id,
      optionValueId: row.optionValueId,
      variantId: row.variantId,
    })),
  });
}

function skuSemanticState(sku: GraphVariant["sku"]) {
  if (!sku) return null;
  // The complete catalog-graph DTO write contract, not just retail price. A
  // recreated SKU must not silently lose supplier/cost/package information.
  return {
    skuCode: sku.skuCode,
    status: sku.status,
    supplierId: sku.supplierId,
    supplierSku: sku.supplierSku,
    supplierCost: restoreNumber(sku.supplierCost),
    costCurrency: sku.costCurrency,
    landedCost: restoreNumber(sku.landedCost),
    price: restoreNumber(sku.price),
    compareAtPrice: restoreNumber(sku.compareAtPrice),
    productWeight: sku.productWeight,
    packageWidth: sku.packageWidth,
    packageHeight: sku.packageHeight,
    packageDepth: sku.packageDepth,
    packageWeight: sku.packageWeight,
    volumetricWeight: sku.volumetricWeight,
  };
}

function optionValueSemanticKey(
  product: AdminProductJson,
  optionValueId: string,
  optionId?: string,
): string {
  for (const option of product.options ?? []) {
    const value = option.values.find((candidate) => candidate.id === optionValueId);
    if (value && (optionId === undefined || optionId === option.id)) {
      return JSON.stringify([option.kind, option.name, value.label]);
    }
  }
  return `invalid-option-value:${optionId ?? ""}:${optionValueId}`;
}

function combinationKey(refs: { optionId: string; optionValueId: string }[]): string {
  return refs.map(({ optionId, optionValueId }) => `${optionId}:${optionValueId}`)
    .sort((a, b) => a.localeCompare(b)).join("|");
}

function variantSemanticKey(product: AdminProductJson, variant: GraphVariant): string {
  const refs = variant.optionValues ?? [];
  // Validate BOTH persisted key and assignments. Ignoring the key could bless
  // a row the backend would reject on the very next save.
  if (variant.combinationKey !== combinationKey(refs)) {
    return `invalid-combination:${variant.id}:${variant.combinationKey}`;
  }
  return JSON.stringify(refs.map((ref) =>
    optionValueSemanticKey(product, ref.optionValueId, ref.optionId)).sort());
}

/**
 * Failure-cleanup invariant: recreated rows may have unavoidable new UUIDs,
 * but the canonical semantic fixture must remain exact. This state rejects
 * duplicates/extras, wrong combinations, wrong SKU semantics, and wrong media
 * scope targets while intentionally ignoring row UUIDs and graph version.
 */
function canonicalSemanticState(product: AdminProductJson): string {
  return JSON.stringify({
    product: {
      id: product.id, slug: product.slug, name: product.name,
      status: product.status, categoryId: product.categoryId,
    },
    tagline: product.tagline,
    options: (product.options ?? [])
      .map((option) => ({
        kind: option.kind,
        name: option.name,
        position: option.position,
        presentation: option.presentation,
        isMediaDriver: option.isMediaDriver,
        isActive: option.isActive,
        values: option.values
          .map((value) => ({
            label: value.label,
            position: value.position,
            swatchHex: value.swatchHex,
            thumbnailUrl: value.thumbnailUrl,
            thumbnailAlt: value.thumbnailAlt,
            isActive: value.isActive,
          }))
          .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    variants: product.variants
      .map((variant) => ({
        name: variant.name,
        position: variant.position,
        combination: variantSemanticKey(product, variant),
        sku: skuSemanticState(variant.sku),
      }))
      .sort((a, b) => a.position - b.position || a.combination.localeCompare(b.combination)),
    media: (product.media ?? [])
      .map((row) => ({
        // Keep both scope axes: a malformed XOR row must not be serialized as
        // just its first target, nor a missing variant mistaken for shared.
        optionValue: row.optionValueId === null ? null
          : optionValueSemanticKey(product, row.optionValueId),
        variant: row.variantId === null ? null : (() => {
          const variant = product.variants.find((variant) => variant.id === row.variantId);
          return variant ? variantSemanticKey(product, variant) : `invalid-variant:${row.variantId}`;
        })(),
        url: row.url,
        type: row.type,
        altText: row.altText,
        sortOrder: row.sortOrder,
      }))
      // Retain duplicates; sort by every field so tied order/URL rows compare
      // deterministically without using UUIDs as a hidden tie-breaker.
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
}

function cleanupError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function restoreClientKey(kind: string, id: string): string {
  return `task5-restore-${kind}-${id}`;
}

function restoreNumber(value: string | number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type RestoreRef = { id: string } | { clientKey: string };
type RestoreOptionValue = RestoreRef & {
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isActive: boolean;
};
type RestoreOption = RestoreRef & {
  kind: string;
  name: string;
  position: number;
  presentation: string;
  isMediaDriver: boolean;
  isActive: boolean;
  values: RestoreOptionValue[];
};
type RestoreVariant = RestoreRef & {
  position: number;
  optionValueRefs: RestoreRef[];
  sku: ReturnType<typeof skuSemanticState>;
};
type RestoreMedia = RestoreRef & {
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  sortOrder: number;
  optionValueId?: string;
  optionValueClientKey?: string;
  variantId?: string;
  variantClientKey?: string;
};

interface RestoreGraphPatch {
  options: RestoreOption[];
  variants: RestoreVariant[];
  media: RestoreMedia[];
  retirements: {
    optionIds: string[];
    optionValueIds: string[];
    variantIds: string[];
    mediaIds: string[];
  };
}

/** Never guess between recreated duplicates. Original owned IDs win, but
 * immutable rows must pass compatibility even on that original-ID path. */
function matchRestoreRow<T extends { id: string }>(
  rows: T[], originalId: string, usedIds: Set<string>,
  semanticMatch: (row: T) => boolean,
  compatible: (row: T) => boolean = () => true,
): T | undefined {
  const available = rows.filter((row) => !usedIds.has(row.id) && compatible(row));
  const original = available.find((row) => row.id === originalId);
  if (original) return original;
  const matches = available.filter(semanticMatch);
  if (matches.length > 1) throw new Error(`ambiguous restore identity for ${originalId}`);
  return matches[0];
}

/**
 * Build a canonical restore patch without assuming any persisted ID still
 * exists. Rows that genuinely disappeared use stable request-local clientKeys;
 * every variant/media scope is mapped through the corresponding key.
 */
function buildRestoreGraphPatch(
  before: AdminProductJson,
  current: AdminProductJson,
): RestoreGraphPatch | null {
  const desiredOptions = before.options ?? [];
  const currentOptions = current.options ?? [];
  if (desiredOptions.length === 0) return null;

  const usedOptionIds = new Set<string>();
  const optionRefMap = new Map<string, RestoreRef>();
  const valueRefMap = new Map<string, RestoreRef>();
  const variantRefMap = new Map<string, RestoreRef>();
  const retirements = {
    optionIds: [] as string[],
    optionValueIds: [] as string[],
    variantIds: [] as string[],
    mediaIds: [] as string[],
  };

  const options: RestoreOption[] = desiredOptions.map((desired) => {
    const target = matchRestoreRow(currentOptions, desired.id, usedOptionIds,
      (candidate) => candidate.kind === desired.kind && candidate.name === desired.name);
    const optionRef: RestoreRef = target
      ? { id: target.id }
      : { clientKey: restoreClientKey("option", desired.id) };
    if (target) usedOptionIds.add(target.id);
    optionRefMap.set(desired.id, optionRef);

    const usedValueIds = new Set<string>();
    const values: RestoreOptionValue[] = desired.values.map((desiredValue) => {
      const targetValue = matchRestoreRow(target?.values ?? [], desiredValue.id,
        usedValueIds, (candidate) => candidate.label === desiredValue.label);
      const valueRef: RestoreRef = targetValue
        ? { id: targetValue.id }
        : { clientKey: restoreClientKey("value", desiredValue.id) };
      if (targetValue) usedValueIds.add(targetValue.id);
      valueRefMap.set(desiredValue.id, valueRef);
      return {
        ...valueRef,
        label: desiredValue.label,
        position: desiredValue.position,
        swatchHex: desiredValue.swatchHex,
        thumbnailUrl: desiredValue.thumbnailUrl,
        thumbnailAlt: desiredValue.thumbnailAlt,
        isActive: desiredValue.isActive,
      };
    });

    for (const currentValue of target?.values ?? []) {
      if (!usedValueIds.has(currentValue.id)) {
        retirements.optionValueIds.push(currentValue.id);
      }
    }

    return {
      ...optionRef,
      kind: desired.kind,
      name: desired.name,
      position: desired.position,
      presentation: desired.presentation,
      isMediaDriver: desired.isMediaDriver,
      isActive: desired.isActive,
      values,
    };
  });

  for (const currentOption of currentOptions) {
    if (!usedOptionIds.has(currentOption.id)) {
      retirements.optionIds.push(currentOption.id);
      for (const value of currentOption.values) {
        if (!retirements.optionValueIds.includes(value.id)) {
          retirements.optionValueIds.push(value.id);
        }
      }
    }
  }

  const usedVariantIds = new Set<string>();
  const variants: RestoreVariant[] = before.variants.map((desired) => {
    const resolvedPairs = (desired.optionValues ?? []).map((ref) => {
      const option = optionRefMap.get(ref.optionId);
      const value = valueRefMap.get(ref.optionValueId);
      return option && "id" in option && value && "id" in value
        ? { optionId: option.id, optionValueId: value.id } : null;
    });
    const resolvedCombination = resolvedPairs.every((pair) => pair !== null)
      ? combinationKey(resolvedPairs) : null;
    // The backend forbids rebinding ANY persisted non-legacy variant, even
    // when the original snapshot ID still exists. A missing/recreated value
    // can force a new combination; create via clientKey and retire that row.
    const compatible = (candidate: GraphVariant) =>
      resolvedCombination !== null && candidate.combinationKey === resolvedCombination;
    const target = matchRestoreRow(current.variants, desired.id, usedVariantIds,
      compatible, compatible);
    const variantRef: RestoreRef = target
      ? { id: target.id }
      : { clientKey: restoreClientKey("variant", desired.id) };
    if (target) usedVariantIds.add(target.id);
    variantRefMap.set(desired.id, variantRef);
    const optionValueRefs = (desired.optionValues ?? []).map((ref) => {
      const valueRef = valueRefMap.get(ref.optionValueId);
      if (!valueRef) {
        throw new Error(
          `restore graph missing option-value mapping for ${ref.optionValueId}`,
        );
      }
      return valueRef;
    });
    return {
      ...variantRef,
      position: desired.position,
      optionValueRefs,
      sku: skuSemanticState(desired.sku),
    };
  });
  for (const currentVariant of current.variants) {
    if (!usedVariantIds.has(currentVariant.id)) {
      retirements.variantIds.push(currentVariant.id);
    }
  }

  const currentMedia = current.media ?? [];
  const usedMediaIds = new Set<string>();
  const media: RestoreMedia[] = (before.media ?? []).map((desired) => {
    const desiredOptionRef = desired.optionValueId
      ? valueRefMap.get(desired.optionValueId)
      : undefined;
    const desiredVariantRef = desired.variantId
      ? variantRefMap.get(desired.variantId)
      : undefined;
    const target =
      currentMedia.find(
        (candidate) => candidate.id === desired.id && !usedMediaIds.has(candidate.id),
      ) ??
      currentMedia.find((candidate) => {
        if (
          usedMediaIds.has(candidate.id) ||
          candidate.url !== desired.url ||
          candidate.type !== desired.type ||
          candidate.altText !== desired.altText ||
          candidate.sortOrder !== desired.sortOrder
        ) {
          return false;
        }
        const optionScopeMatches = desiredOptionRef
          ? "id" in desiredOptionRef && candidate.optionValueId === desiredOptionRef.id
          : candidate.optionValueId === null;
        const variantScopeMatches = desiredVariantRef
          ? "id" in desiredVariantRef && candidate.variantId === desiredVariantRef.id
          : candidate.variantId === null;
        return optionScopeMatches && variantScopeMatches;
      });
    const mediaRef: RestoreRef = target
      ? { id: target.id }
      : { clientKey: restoreClientKey("media", desired.id) };
    if (target) usedMediaIds.add(target.id);

    const row: RestoreMedia = {
      ...mediaRef,
      url: desired.url,
      type: desired.type,
      altText: desired.altText,
      sortOrder: desired.sortOrder,
    };
    if (desired.optionValueId) {
      const valueRef = valueRefMap.get(desired.optionValueId);
      if (!valueRef) {
        throw new Error(
          `restore graph missing media option-value mapping for ${desired.optionValueId}`,
        );
      }
      if ("id" in valueRef) row.optionValueId = valueRef.id;
      else row.optionValueClientKey = valueRef.clientKey;
    }
    if (desired.variantId) {
      const variantRef = variantRefMap.get(desired.variantId);
      if (!variantRef) {
        throw new Error(
          `restore graph missing media variant mapping for ${desired.variantId}`,
        );
      }
      if ("id" in variantRef) row.variantId = variantRef.id;
      else row.variantClientKey = variantRef.clientKey;
    }
    return row;
  });
  for (const currentMediaRow of currentMedia) {
    if (!usedMediaIds.has(currentMediaRow.id)) {
      retirements.mediaIds.push(currentMediaRow.id);
    }
  }

  return { options, variants, media, retirements };
}

/**
 * Failure-safe fixture restore. Every cleanup phase is attempted independently;
 * the returned failures are appended to (rather than replacing) the primary
 * browser assertion failure by the caller.
 */
async function restoreProductSnapshot(
  before: AdminProductJson,
  slug: string = COLOR_SIZE_SLUG,
): Promise<string[]> {
  const failures: string[] = [];
  let current: AdminProductJson;
  try {
    current = await adminProduct(slug);
  } catch (error) {
    failures.push(`read current product: ${cleanupError(error)}`);
    return failures;
  }

  if (current.tagline !== before.tagline) {
    try {
      await adminPatch(current.id, { tagline: before.tagline });
      current = await adminProduct(slug);
    } catch (error) {
      failures.push(`restore tagline: ${cleanupError(error)}`);
    }
  }

  let graphPatch: RestoreGraphPatch | null = null;
  try {
    graphPatch = buildRestoreGraphPatch(before, current);
  } catch (error) {
    failures.push(`build catalog graph cleanup patch: ${cleanupError(error)}`);
  }
  if (graphPatch && canonicalSemanticState(current) !== canonicalSemanticState(before)) {
    try {
      await adminPatch(current.id, {
        catalogGraphVersion: current.catalogGraphVersion,
        catalogGraph: graphPatch,
      });
    } catch (firstError) {
      // Refresh both graph version and row identities before retrying. The first
      // request may have advanced the optimistic version before surfacing a
      // retirement/reference error.
      try {
        const refreshed = await adminProduct(slug);
        const refreshedPatch = buildRestoreGraphPatch(before, refreshed);
        if (!refreshedPatch) throw new Error("no graph patch after refresh");
        await adminPatch(refreshed.id, {
          catalogGraphVersion: refreshed.catalogGraphVersion,
          catalogGraph: {
            ...refreshedPatch,
            retirements: {
              optionIds: [],
              optionValueIds: [],
              variantIds: [],
              mediaIds: [],
            },
          },
        });
      } catch (secondError) {
        failures.push(
          `restore catalog graph: ${cleanupError(firstError)}; fallback: ${cleanupError(secondError)}`,
        );
      }
    }
  }

  try {
    const after = await adminProduct(slug);
    if (canonicalSemanticState(after) !== canonicalSemanticState(before)) {
      failures.push(
        "post-cleanup product state differs from the captured canonical snapshot, including persisted identities or exact scopes",
      );
    }
  } catch (error) {
    failures.push(`verify post-cleanup product state: ${cleanupError(error)}`);
  }
  return failures;
}


// --- browser helpers ---------------------------------------------------------

/**
 * Zero console errors, page errors, or hydration warnings is a hard gate.
 * Hydration mismatches surface as React console errors in dev; the explicit
 * warning scan catches the "Warning: … hydration" family as well.
 */
function trackBrowserErrors(page: Page): () => void {
  const errors: string[] = [];
  const hydration: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning" && /hydrat/i.test(message.text())) {
      hydration.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return () => {
    expect(
      errors,
      `expected zero console/page errors, got:\n${errors.join("\n")}`,
    ).toEqual([]);
    expect(
      hydration,
      `expected zero hydration warnings, got:\n${hydration.join("\n")}`,
    ).toEqual([]);
  };
}

/**
 * Audits storefront product-page requests (`/products/<slug>`), which is what a
 * public preview iframe or link would trigger. `/admin/products/...` and
 * `/api/v1/storefront/products/...` never match: the path must START with
 * `/products/`.
 */
function auditPdpRequests(page: Page): () => string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/products/")) seen.push(path);
  });
  return () => seen;
}

async function gotoAdmin(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function loginAsAdmin(page: Page): Promise<void> {
  await gotoAdmin(page, "/admin/login");
  await page.locator("input[type=email]").fill(E2E_ADMIN_EMAIL);
  await page.locator("input[type=password]").fill(E2E_ADMIN_PASSWORD);
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/, { timeout: 30_000 });
}

/** Logs in, resolves the seeded product id through the API, opens the editor. */
async function openEditor(page: Page, slug: string): Promise<string> {
  await loginAsAdmin(page);
  const productId = await adminProductIdFor(slug);
  await gotoAdmin(page, `/admin/products/${productId}/edit`);
  await expect(page.getByRole("tablist")).toBeVisible();
  return productId;
}

/**
 * Opens the editor with a session seeded from the cached login's refresh token.
 * The admin login route allows ten requests per ten minutes per IP and the gate
 * spends that budget, so scenarios added late in the file must not log in
 * again; the app mints its access token from the stored refresh token instead
 * (that route allows thirty per window).
 */
async function openEditorWithStoredSession(
  page: Page,
  slug: string,
): Promise<string> {
  await withAdminToken(async () => undefined);
  if (adminRefreshToken === null) throw new Error("no cached admin session");
  const refreshToken = adminRefreshToken;
  await page.addInitScript((token) => {
    window.localStorage.setItem("sh_admin_refresh", token);
  }, refreshToken);
  const productId = await adminProductIdFor(slug);
  await gotoAdmin(page, `/admin/products/${productId}/edit`);
  await expect(page.getByRole("tablist")).toBeVisible();
  return productId;
}

function tab(page: Page, key: TabKey, lang: "zh" | "en" = "zh") {
  const name = lang === "zh" ? ZH.tabs[key] : EN.tabs[key];
  return page.getByRole("tab", { name, exact: true });
}

async function selectTab(page: Page, key: TabKey, lang: "zh" | "en" = "zh"): Promise<void> {
  await tab(page, key, lang).click();
  await expect(page.locator(`#pf-panel-${key}`)).toBeVisible();
}

/** The panel is keyed by tab, so this also proves the switch actually happened. */
async function activeTabKey(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? "",
  );
}

async function focusedElementId(page: Page): Promise<string> {
  return page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.id ?? "",
  );
}

/**
 * The page itself must never scroll horizontally. The matrix owns its own
 * scroller, so any overflow that escapes to <html> is a layout regression.
 */
async function assertNoPageOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }));
  expect(
    metrics.docScroll,
    `${label}: documentElement scrollWidth ${metrics.docScroll} > clientWidth ${metrics.docClient}`,
  ).toBeLessThanOrEqual(metrics.docClient + 1);
  expect(
    metrics.bodyScroll,
    `${label}: body scrollWidth ${metrics.bodyScroll} > clientWidth ${metrics.docClient}`,
  ).toBeLessThanOrEqual(metrics.docClient + 1);
}

/**
 * The focused control must be hit-testable at its own centre — i.e. the sticky
 * status/save bar and section navigation are not covering it. Uses the visible
 * (viewport-clipped) centre so a horizontally scrolled control is still judged
 * fairly, and fails outright when the control is entirely off-screen.
 */
async function assertFocusNotCovered(page: Page, label: string): Promise<void> {
  const result = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { ok: false, reason: "no focused element" };
    }
    const rect = el.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, window.innerWidth);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    if (right <= left || bottom <= top) {
      return { ok: false, reason: `focused ${el.id || el.tagName} is off-screen` };
    }
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    const ok = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    return {
      ok,
      reason: hit
        ? `covered by ${hit.tagName}.${String((hit as HTMLElement).className).slice(0, 60)}`
        : "no element at the focused centre",
    };
  });
  expect(result.ok, `${label}: ${result.reason}`).toBe(true);
}

/** The named validation alert must remain visible and hit-testable after deep scroll. */
async function assertElementNotCovered(
  locator: Locator,
  label: string,
): Promise<void> {
  const result = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, window.innerWidth);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    if (right <= left || bottom <= top) {
      return { ok: false, reason: "element is off-screen" };
    }
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    const ok = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    return {
      ok,
      reason: hit
        ? `covered by ${hit.tagName}.${String((hit as HTMLElement).className).slice(0, 60)}`
        : "nothing at the alert centre",
    };
  });
  expect(result.ok, `${label}: ${result.reason}`).toBe(true);
}

/** Same hit-test for a named control (used for the sticky save button). */
async function assertControlClickable(
  page: Page,
  selector: string,
  label: string,
): Promise<void> {
  const result = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return { ok: false, reason: "not found" };
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { ok: false, reason: "zero box" };
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    const ok = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    return {
      ok,
      reason: hit
        ? `covered by ${hit.tagName}.${String((hit as HTMLElement).className).slice(0, 60)}`
        : "nothing at the centre",
    };
  }, selector);
  expect(result.ok, `${label}: ${result.reason}`).toBe(true);
}

async function scrollBelowSticky(page: Page, selector: string): Promise<void> {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.evaluate((sel) => {
    const target = document.querySelector(sel) as HTMLElement | null;
    const tablist = document.querySelector('[role="tablist"]');
    const sticky = tablist?.closest('[class*="sticky"]') as HTMLElement | null;
    if (!target || !sticky) return;
    const targetRect = target.getBoundingClientRect();
    const stickyRect = sticky.getBoundingClientRect();
    const desiredTop = stickyRect.bottom + 16;
    if (targetRect.top < desiredTop) {
      window.scrollBy(0, targetRect.top - desiredTop);
    }
  }, selector);
}

const SAVE_BUTTON = 'button[type="submit"][aria-busy]';

/** A row-scoped control: the <li> that owns the media URL input. */
function mediaRow(page: Page, urlAriaLabel: string) {
  return page.getByLabel(urlAriaLabel, { exact: true }).locator("xpath=ancestor::li[1]");
}

function scopedMediaUrlInputs(page: Page) {
  return page.locator('input[aria-label$="的媒体 URL"]');
}

/** The option group <li> that owns the given option's name input. */
function optionGroup(page: Page, number: number) {
  return page
    .getByLabel(`选项 ${number} 名称`, { exact: true })
    .locator("xpath=ancestor::li[1]");
}

/**
 * The preview tab's "saved storefront page" block. The panel's Section hint
 * reuses the same unsaved-changes copy, so every notice assertion is scoped
 * here to keep the two apart.
 */
function savedPageBlock(page: Page) {
  return page.locator("#pf-panel-preview h4").first().locator("xpath=..");
}

/**
 * Gating worker setup: this is deliberately a beforeAll, not an ordinary test.
 * A failure here prevents every mutation-capable test body from running.
 */
test.beforeAll(async ({ baseURL }) => {
  const target = assertE2EDatabaseUrl(CONFIGURED_DATABASE_URL);
  expect(target.database).toBe("small_house_variant_test");
  expect(baseURL, "frontend origin").toBe("http://localhost:3211");
  expect(new URL(API).hostname, "backend host").toBe("127.0.0.1");
  expect(API, "backend port").toContain(":3210");

  const direct = await playwrightRequest.newContext();
  const proxy = await playwrightRequest.newContext({ baseURL });
  try {
    const directResponse = await direct.get(
      `${API}/storefront/products/${COLOR_SIZE_SLUG}`,
    );
    const proxyResponse = await proxy.get(
      `/api/v1/storefront/products/${COLOR_SIZE_SLUG}`,
    );
    expect(directResponse.ok(), "direct guarded backend response").toBeTruthy();
    expect(proxyResponse.ok(), "frontend rewrite response").toBeTruthy();
    const directBody = (await directResponse.json()) as
      | { product: { id: string; slug: string } }
      | { id: string; slug: string };
    const proxyBody = (await proxyResponse.json()) as
      | { product: { id: string; slug: string } }
      | { id: string; slug: string };
    const directProduct = "product" in directBody ? directBody.product : directBody;
    const proxyProduct = "product" in proxyBody ? proxyBody.product : proxyBody;
    // Stable ID/slug equality proves the browser rewrite reaches the same
    // guarded backend that direct API assertions use, not a stale service.
    expect(
      { id: proxyProduct.id, slug: proxyProduct.slug },
      "frontend rewrite and direct backend identity",
    ).toEqual({ id: directProduct.id, slug: directProduct.slug });
    expect(proxyProduct.slug).toBe(COLOR_SIZE_SLUG);

    const listing = await withAdminToken(async (token, context) => {
      const response = await context.get(`${API}/admin/products?pageSize=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.ok(), "guarded admin listing").toBeTruthy();
      return (await response.json()) as {
        items: { slug: string }[];
        total: number;
      };
    });
    expect(listing.items.length).toBe(listing.total);
    expect(listing.items.map((item) => item.slug).sort()).toEqual(SEEDED_SLUGS);
    expect(
      listing.items.every((item) => item.slug.startsWith("e2e-")),
      "no non-scenario product is reachable",
    ).toBe(true);
  } finally {
    await direct.dispose();
    await proxy.dispose();
  }
});


test.describe("Cleanup identity contract", () => {
  test("real backend restores a disposable recreated graph without rebinding persisted variants", async () => {
    const slug = `e2e-cleanup-${randomUUID()}`;
    const seed = await adminProduct(COLOR_SIZE_SLUG);
    const sharedBefore = persistedIdentityState(seed);
    let createdId: string | undefined;
    let primaryError: unknown;
    const cleanupFailures: string[] = [];
    const sku = (color: string) => ({
      skuCode: `${slug}-${color}`,
      status: "ACTIVE",
      supplierId: null,
      supplierSku: `supplier-${color}`,
      supplierCost: 41.25,
      costCurrency: "PHP",
      landedCost: 58.75,
      price: 1299,
      compareAtPrice: 1499,
      productWeight: 1.5,
      packageWidth: 20,
      packageHeight: 30,
      packageDepth: 40,
      packageWeight: 2.5,
      volumetricWeight: 4,
    });
    try {
      // Create through the real API, always DRAFT. No browser navigation or Next
      // cache for this disposable product, and no mutation of the shared seed.
      const created = await adminCreate({
        name: "Disposable cleanup contract",
        slug,
        categoryId: seed.categoryId,
        status: "DRAFT",
      });
      createdId = created.id;
      await adminPatch(created.id, {
        catalogGraphVersion: created.catalogGraphVersion,
        catalogGraph: {
          options: [{
            clientKey: "color", kind: "COLOR", name: "Color", position: 0,
            presentation: "SWATCH", isMediaDriver: true, isActive: true,
            values: ["Red", "Blue"].map((label, position) => ({
              clientKey: label, label, position, isActive: true,
              swatchHex: position === 0 ? "#c0392b" : "#2471a3",
            })),
          }],
          variants: ["Red", "Blue"].map((color, position) => ({
            clientKey: `variant-${color}`, position,
            optionValueRefs: [{ clientKey: color }], sku: sku(color),
          })),
          // Deliberately identical content/order across scopes: URL/order-only
          // matching must not confuse shared, value, and exact-variant media.
          media: [
            { clientKey: "shared" },
            { clientKey: "red-media", optionValueClientKey: "Red" },
            { clientKey: "blue-media", optionValueClientKey: "Blue" },
            { clientKey: "variant-media", variantClientKey: "variant-Blue" },
          ].map((scope) => ({ ...scope, url: RED_VALUE_URL, type: "IMAGE", altText: "Same content", sortOrder: 0 })),
        },
      });
      const before = await adminProduct(slug);
      const color = optionByName(before, "Color");
      const red = valueByLabel(color, "Red");
      const blue = valueByLabel(color, "Blue");
      const redVariant = variantByName(before, "Red");
      const blueVariant = variantByName(before, "Blue");
      const replacementValueId = randomUUID();
      const replacementVariantId = randomUUID();
      const replacementSkuId = randomUUID();

      // Fault injection only: API retirement deliberately retains option/value
      // rows, so actual identity loss needs a guarded disposable DB fixture.
      // All reconstruction and verification below still use the real backend.
      assertE2EDatabaseUrl(CONFIGURED_DATABASE_URL);
      execFileSync("pnpm", ["exec", "tsx", "-e", `
        import assert from 'node:assert/strict';
        import { randomUUID } from 'node:crypto';
        import { PrismaPg } from '@prisma/adapter-pg';
        import { PrismaClient } from './src/generated/prisma/client.ts';
        import { assertE2EDatabaseUrl } from '../frontend/src/lib/e2e-guard.ts';
        const { before, slug, blue, red, blueVariant, replacementValueId, replacementVariantId, replacementSkuId } = JSON.parse(process.env.E2E_CLEANUP_FIXTURE!);
        async function main() {
          assertE2EDatabaseUrl(process.env.DATABASE_URL);
          const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
          try {
            const [database] = await prisma.$queryRawUnsafe('SELECT current_database() AS name');
            assert.equal(database.name, 'small_house_variant_test');
            await prisma.$transaction(async (tx) => {
              const owned = await tx.product.findUniqueOrThrow({ where: { id: before.id } });
              assert.equal(owned.slug, slug);
              assert.match(slug, /^e2e-cleanup-/);
              assert.equal(owned.status, 'DRAFT');
              assertE2EDatabaseUrl(process.env.DATABASE_URL);
              await tx.productOptionValue.update({ where: { id: blue.id, productId: before.id }, data: { id: replacementValueId } });
              await tx.productVariant.update({
                where: { id: blueVariant.id, productId: before.id },
                data: { id: replacementVariantId, combinationKey: blueVariant.combinationKey.replace(blue.id, replacementValueId) },
              });
              await tx.sku.update({
                where: { id: blueVariant.sku.id, productId: before.id },
                data: { id: replacementSkuId, supplierSku: 'dirty-supplier', packageWeight: 99 },
              });
              for (const media of before.media) {
                await tx.productImage.update({ where: { id: media.id, productId: before.id }, data: { id: randomUUID() } });
              }
              // Retain Red's incompatible variant/SKU but remove its value,
              // assignments and value-scoped media via FK cascades.
              await tx.productOptionValue.delete({ where: { id: red.id, productId: before.id } });
            });
          } finally { await prisma.$disconnect(); }
        }
        main().catch((error) => { console.error(error); process.exitCode = 1; });
      `], {
        cwd: resolve(__dirname, "../../backend"),
        env: {
          ...process.env, DATABASE_URL: CONFIGURED_DATABASE_URL,
          E2E_CLEANUP_FIXTURE: JSON.stringify({ before, slug, blue, red, blueVariant, replacementValueId, replacementVariantId, replacementSkuId }),
        },
        stdio: "pipe",
      });
      const recreated = await adminProduct(slug);
      expect(valueByLabel(optionByName(recreated, "Color"), "Blue").id).toBe(replacementValueId);
      expect(variantByName(recreated, "Blue").id).toBe(replacementVariantId);
      expect(variantByName(recreated, "Blue").sku!.id).toBe(replacementSkuId);
      expect(variantByName(recreated, "Red").id).toBe(redVariant.id);
      expect(recreated.media!.every((row) => !before.media!.some((old) => old.id === row.id))).toBe(true);

      const failures = await restoreProductSnapshot(before, slug);
      expect(failures, "actual backend cleanup failures").toEqual([]);
      const after = await adminProduct(slug); // fresh direct backend, never Next
      expect(canonicalSemanticState(after)).toBe(canonicalSemanticState(before));
      const afterColor = optionByName(after, "Color");
      const afterRed = valueByLabel(afterColor, "Red");
      const afterBlue = valueByLabel(afterColor, "Blue");
      const afterRedVariant = variantByName(after, "Red");
      const afterBlueVariant = variantByName(after, "Blue");
      expect(
        (afterRedVariant.optionValues ?? []).map((ref) => ref.optionValueId).sort(),
        "independent Red variant assignment oracle",
      ).toEqual([afterRed.id]);
      expect(
        (afterBlueVariant.optionValues ?? []).map((ref) => ref.optionValueId).sort(),
        "independent Blue variant assignment oracle",
      ).toEqual([afterBlue.id]);
      expect(scopeSignature(after), "independent media scope oracle").toEqual([
        `shared|${RED_VALUE_URL}`,
        `value:${afterRed.id}|${RED_VALUE_URL}`,
        `value:${afterBlue.id}|${RED_VALUE_URL}`,
        `variant:${afterBlueVariant.id}|${RED_VALUE_URL}`,
      ].sort());
      expect(persistedIdentityState(after)).not.toBe(persistedIdentityState(before));
      expect(afterBlueVariant.id, "reuse compatible replacement").toBe(replacementVariantId);
      expect(afterBlueVariant.sku!.id).toBe(replacementSkuId);
      expect(afterRedVariant.id, "never rebind the incompatible row").not.toBe(redVariant.id);
      for (const color of ["Red", "Blue"]) {
        // Independent field assertions prevent a lossy semantic comparator from
        // blessing incomplete SKU restoration or a newly-created bare SKU.
        expect(variantByName(after, color).sku).toMatchObject({
          ...sku(color), supplierCost: "41.25", landedCost: "58.75",
          price: "1299", compareAtPrice: "1499",
        });
      }
      expect(after.status).toBe("DRAFT");
      expect(after.catalogGraphVersion).toBeGreaterThan(before.catalogGraphVersion);
      expect(persistedIdentityState(await adminProduct(COLOR_SIZE_SLUG))).toBe(sharedBefore);
    } catch (error) {
      primaryError = error;
    } finally {
      if (createdId) {
        try { await adminDelete(createdId); }
        catch (error) { cleanupFailures.push(`delete disposable product: ${cleanupError(error)}`); }
      }
    }
    if (primaryError || cleanupFailures.length) {
      throw new Error([primaryError ? cleanupError(primaryError) : "", ...cleanupFailures].filter(Boolean).join("\n"), { cause: primaryError });
    }
  });
});


test.describe("Responsive layout", () => {
  test("375x812 / 768x1024 / 1280x720: all panels, sticky chrome, overflow, and errors remain usable", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const stopErrors = trackBrowserErrors(page);
    await openEditor(page, COLOR_SIZE_SLUG);
    const originalName = await page.locator("#pf-name").inputValue();

    for (const viewport of [
      { width: 375, height: 812, label: "375x812" },
      { width: 768, height: 1024, label: "768x1024" },
      { width: 1280, height: 720, label: "1280x720" },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const at = viewport.label;

      // Scroll to a lower basic field first. The status/save area and section
      // navigation must remain visible and hit-testable at every viewport.
      await selectTab(page, "basic");
      await scrollBelowSticky(page, "#pf-description");
      await expect(page.locator("#pf-status")).toBeVisible();
      await expect(page.locator(SAVE_BUTTON)).toBeVisible();
      await assertControlClickable(page, "#pf-status", `${at} status select after scroll`);
      await assertControlClickable(page, SAVE_BUTTON, `${at} save button after scroll`);
      await assertControlClickable(page, "#pf-tab-basic", `${at} nav after scroll`);
      await assertNoPageOverflow(page, `${at} lower basic`);

      // Trigger client validation without sending a mutation. The visible
      // field error remains uncovered, then restore the original value.
      await page.locator("#pf-name").fill("");
      await page.locator(SAVE_BUTTON).click();
      const nameError = page
        .locator('[role="alert"]')
        .filter({ hasText: "商品名必填。" });
      await expect(nameError).toHaveCount(1);
      await expect(nameError).toBeVisible();
      await scrollBelowSticky(page, "#pf-name");
      await expect(nameError).toBeVisible();
      await assertElementNotCovered(nameError, `${at} validation alert`);
      await page.locator("#pf-name").focus();
      await assertFocusNotCovered(page, `${at} focused validation error`);
      await page.locator("#pf-name").fill(originalName);

      // Every one of the seven panels is rendered and checked at every
      // viewport. Scrolling each panel exercises the sticky chrome repeatedly.
      for (const key of TAB_KEYS) {
        await selectTab(page, key);
        const panel = page.locator(`#pf-panel-${key}`);
        await panel.scrollIntoViewIfNeeded();
        await expect(panel).toBeVisible();
        await assertNoPageOverflow(page, `${at} ${key}`);
        await assertControlClickable(page, "#pf-status", `${at} ${key} status`);
        await assertControlClickable(page, SAVE_BUTTON, `${at} ${key} save`);
        await assertControlClickable(page, `#pf-tab-${key}`, `${at} ${key} nav`);
      }

      // VariantMatrix overflow must remain inside its own scroller, never on
      // the page. Recheck the local dimensions after the panel scroll.
      await selectTab(page, "variants");
      const matrix = await page.evaluate(() => {
        const table = document.querySelector("#pf-panel-variants table");
        const scroller = table?.parentElement as HTMLElement | null;
        if (!table || !scroller) return null;
        return {
          overflowX: getComputedStyle(scroller).overflowX,
          scrollerClient: scroller.clientWidth,
          scrollerScroll: scroller.scrollWidth,
        };
      });
      expect(matrix, `${at}: matrix scroller exists`).toBeTruthy();
      expect(["auto", "scroll"]).toContain(matrix!.overflowX);
      if (viewport.width < 880) {
        expect(
          matrix!.scrollerScroll,
          `${at}: matrix scroller must actually scroll`,
        ).toBeGreaterThan(matrix!.scrollerClient);
      }
    }

    await stopErrors();
  });
});

test.describe("Keyboard access", () => {
  test("section nav is a real tablist: Tab, arrows, Home/End and Enter/Space", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const stopErrors = trackBrowserErrors(page);
    await openEditor(page, COLOR_SIZE_SLUG);

    await expect(page.getByRole("tablist")).toHaveAttribute("aria-label", ZH.tabsAria);

    // Start from the document's natural focus order. No locator.focus() is
    // used: this is the same Tab path an operator takes from the page start.
    let reachedBasic = false;
    for (let step = 0; step < 80; step += 1) {
      await page.keyboard.press("Tab");
      if ((await focusedElementId(page)) === "pf-tab-basic") {
        reachedBasic = true;
        break;
      }
    }
    expect(reachedBasic, "natural Tab order reaches the selected first tab").toBe(true);

    // Roving focus: the arrow keys move focus AND select.
    await page.keyboard.press("ArrowRight");
    expect(await focusedElementId(page)).toBe("pf-tab-media");
    expect(await activeTabKey(page)).toBe("pf-tab-media");
    await expect(page.locator("#pf-panel-media")).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    expect(await focusedElementId(page)).toBe("pf-tab-basic");
    expect(await activeTabKey(page)).toBe("pf-tab-basic");

    await page.keyboard.press("End");
    expect(await focusedElementId(page)).toBe("pf-tab-preview");
    expect(await activeTabKey(page)).toBe("pf-tab-preview");

    await page.keyboard.press("Home");
    expect(await focusedElementId(page)).toBe("pf-tab-basic");
    expect(await activeTabKey(page)).toBe("pf-tab-basic");

    // ArrowLeft from the first tab wraps to the last.
    await page.keyboard.press("ArrowLeft");
    expect(await focusedElementId(page)).toBe("pf-tab-preview");
    expect(await activeTabKey(page)).toBe("pf-tab-preview");

    // Enter and Space must activate a focused-but-unselected tab. The focus
    // setup is deliberately separate from arrow navigation: ProductFormHeader
    // retains the approved roving behavior where arrows select immediately.
    await selectTab(page, "basic");
    await page.evaluate(() => document.getElementById("pf-tab-seo")?.focus());
    expect(await focusedElementId(page)).toBe("pf-tab-seo");
    expect(await activeTabKey(page)).toBe("pf-tab-basic");
    await page.keyboard.press("Enter");
    expect(await activeTabKey(page)).toBe("pf-tab-seo");
    await expect(page.locator("#pf-panel-seo")).toBeVisible();

    await page.evaluate(() => document.getElementById("pf-tab-preview")?.focus());
    expect(await focusedElementId(page)).toBe("pf-tab-preview");
    expect(await activeTabKey(page)).toBe("pf-tab-seo");
    await page.keyboard.press(" ");
    expect(await activeTabKey(page)).toBe("pf-tab-preview");
    await expect(page.locator("#pf-panel-preview")).toBeVisible();

    // Real Tab order: the selected tab is the only tab stop, so Tab leaves the
    // tablist into the panel and Shift+Tab comes back to it.
    await page.keyboard.press("Tab");
    const afterTab = await focusedElementId(page);
    expect(afterTab.startsWith("pf-tab-"), "Tab must leave the tablist").toBe(false);
    await assertFocusNotCovered(page, "focus after Tab out of the tablist");
    await page.keyboard.press("Shift+Tab");
    expect(await focusedElementId(page)).toBe("pf-tab-preview");

    // Continue through the header controls with real Shift+Tab presses; each
    // stop must remain visible beneath the sticky chrome.
    for (let step = 0; step < 3; step += 1) {
      await page.keyboard.press("Shift+Tab");
      await assertFocusNotCovered(page, `reverse Tab stop ${step + 1}`);
    }

    await stopErrors();
  });
});

test.describe("New product", () => {
  test("defaults to DRAFT, previews nothing public, and a save does not publish", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const stopErrors = trackBrowserErrors(page);
    const pdpRequests = auditPdpRequests(page);
    const nonce = Date.now() % 1_000_000;
    const slug = `e2e-admin-new-${nonce}`;

    let createdId: string | null = null;
    try {
      await loginAsAdmin(page);
      await gotoAdmin(page, "/admin/products/new");
      await expect(page.getByRole("heading", { name: ZH.newTitle })).toBeVisible();

      // Defaults: DRAFT, and the save button says "save draft" (never publish).
      await expect(page.locator("#pf-status")).toHaveValue("DRAFT");
      await expect(page.locator(SAVE_BUTTON)).toHaveText(ZH.saveDraft);

      // Preview tab: explicitly says nothing public exists yet — no iframe, no
      // storefront link, and no storefront request.
      await selectTab(page, "preview");
      await expect(savedPageBlock(page).getByText(ZH.newProductNote)).toBeVisible();
      await expect(page.locator("#pf-panel-preview iframe")).toHaveCount(0);
      await expect(
        page.locator('#pf-panel-preview a[href^="/products/"]'),
      ).toHaveCount(0);
      expect(pdpRequests()).toEqual([]);

      // Fill the required fields and save.
      await selectTab(page, "basic");
      await page.locator("#pf-name").fill(`E2E Admin New ${nonce}`);
      await page.locator("#pf-category").selectOption({ label: "E2E Catalog" });
      await selectTab(page, "seo");
      await page.locator("#pf-slug").fill(slug);
      await page.locator(SAVE_BUTTON).click();

      await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+\/edit/, {
        timeout: 30_000,
      });
      createdId = page.url().split("/products/")[1]!.split("/")[0]!;
      await expect(page.getByRole("tablist")).toBeVisible();

      // The save must NOT have published: the created row is still DRAFT...
      const created = await adminProduct(slug);
      expect(created.id).toBe(createdId);
      expect(created.status, "a save must not implicitly publish").toBe("DRAFT");
      expect(created.slug).toBe(slug);

      // ...and the storefront cannot see it at all.
      const storefrontStatus = await withAdminToken(async (_token, context) => {
        const response = await context.get(`${API}/storefront/products/${slug}`);
        return response.status();
      });
      expect(storefrontStatus, "a DRAFT product is not publicly reachable").toBe(404);

      // On the edit page the preview still refuses to request a public page.
      await selectTab(page, "preview");
      await expect(savedPageBlock(page).getByText(ZH.inactiveSavedNote)).toBeVisible();
      await expect(page.locator("#pf-panel-preview iframe")).toHaveCount(0);
      expect(pdpRequests()).toEqual([]);

      await stopErrors();
    } finally {
      if (createdId) await adminDelete(createdId);
      else {
        const id = await adminProductIdFor(slug).catch(() => null);
        if (id) await adminDelete(id);
      }
    }
  });
});

test.describe("Typed Color x Size edit", () => {
  test("keeps edits across sections and preserves option/variant/SKU identity", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const stopErrors = trackBrowserErrors(page);
    const before = await adminProduct(COLOR_SIZE_SLUG);
    const beforeOption = optionByName(before, "Color");
    const beforeValue = valueByLabel(beforeOption, "Red");
    const beforeTagline = before.tagline;
    /** Row identity only — labels are deliberately allowed to change. */
    const identity = (product: AdminProductJson) => ({
      options: product.options!.map((option) => ({
        id: option.id,
        valueIds: option.values.map((value) => value.id),
      })),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        combinationKey: variant.combinationKey,
        skuId: variant.sku?.id ?? null,
        skuCode: variant.sku?.skuCode ?? null,
      })),
    });
    const identityBefore = identity(before);

    const renamed = `Red E2E ${Date.now() % 100_000}`;
    const tagline = `E2E tagline ${Date.now() % 100_000}`;
    let primaryError: unknown = null;
    try {
      await openEditor(page, COLOR_SIZE_SLUG);

      // Edit a scalar (Basic) and a graph row (Options) in different sections.
      await page.locator("#pf-tagline").fill(tagline);
      await selectTab(page, "variants");
      const valueLabel = optionGroup(page, 1).getByLabel("选项值 1 标签", { exact: true });
      await expect(valueLabel).toHaveValue("Red");
      await valueLabel.fill(renamed);

      // Walk the whole section nav; the panel is re-rendered from scratch on
      // every switch, so surviving this proves state lives outside the panels.
      for (const key of ["media", "basic", "specs", "shipping", "seo", "preview"] as const) {
        await selectTab(page, key);
      }
      await selectTab(page, "variants");
      await expect(
        optionGroup(page, 1).getByLabel("选项值 1 标签", { exact: true }),
      ).toHaveValue(renamed);
      await selectTab(page, "basic");
      await expect(page.locator("#pf-tagline")).toHaveValue(tagline);

      // Save, then read committed truth from the BACKEND.
      await page.locator(SAVE_BUTTON).click();
      await expect(page.getByText(ZH.saved)).toBeVisible({ timeout: 30_000 });

      const saved = await adminProduct(COLOR_SIZE_SLUG);
      expect(valueByLabel(optionByName(saved, "Color"), renamed).id).toBe(beforeValue.id);
      expect(saved.tagline).toBe(tagline);
      // Identity is stable: the graph patch upserts by id, so no option, value,
      // variant or SKU may be recreated by a save.
      expect(identity(saved)).toEqual(identityBefore);
      expect(saved.catalogGraphVersion).toBeGreaterThan(before.catalogGraphVersion);

      // Restore the canonical fixture through the same UI.
      await selectTab(page, "variants");
      await optionGroup(page, 1).getByLabel("选项值 1 标签", { exact: true }).fill("Red");
      await selectTab(page, "basic");
      await page.locator("#pf-tagline").fill(beforeTagline ?? "");
      await page.locator(SAVE_BUTTON).click();
      await expect(page.getByText(ZH.saved)).toBeVisible({ timeout: 30_000 });

      const restored = await adminProduct(COLOR_SIZE_SLUG);
      expect(restored.tagline).toBe(beforeTagline);
      expect(optionByName(restored, "Color").values.map((v) => v.label)).toEqual(
        beforeOption.values.map((v) => v.label),
      );
      expect(identity(restored)).toEqual(identityBefore);

      await stopErrors();
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupFailures = await restoreProductSnapshot(before);
      if (primaryError) {
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            [primaryError, ...cleanupFailures.map((message) => new Error(message))],
            "typed graph assertion failed; cleanup also reported failures",
          );
        }
        throw primaryError;
      }
      if (cleanupFailures.length > 0) {
        throw new Error(`typed graph cleanup failed: ${cleanupFailures.join("; ")}`);
      }
    }
  });
});

test.describe("Scoped media + gallery driver", () => {
  test("driver switching preserves value rows; value + exact-variant scopes save XOR/disjoint and never merge", async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const stopErrors = trackBrowserErrors(page);
    const before = await adminProduct(COLOR_SIZE_SLUG);
    const beforeSignature = scopeSignature(before);
    const colorOption = optionByName(before, "Color");
    const blueValue = valueByLabel(colorOption, "Blue");
    const redValue = valueByLabel(colorOption, "Red");
    const blueSmall = variantByName(before, "Blue / Small");
    let primaryError: unknown = null;

    try {
      await openEditor(page, COLOR_SIZE_SLUG);
      await selectTab(page, "media");

      // --- A. driver switching (draft only, never saved) --------------------
      const driver = page.getByLabel(ZH.driverSelect, { exact: true });
      await expect(driver).toBeVisible();
      await driver.selectOption({ label: "Color" });
      await expect(page.getByText(ZH.sharedGallery).first()).toBeVisible();
      expect(await scopedMediaUrlInputs(page).count()).toBe(2); // Red 1 + Blue 1
      await expect(page.locator("summary").filter({ hasText: ZH.inactiveTitle })).toHaveCount(0);

      // Hand the gallery to Size (which has no media of its own).
      await driver.selectOption({ label: "Size" });
      await expect(page.getByText(ZH.noValueMedia).first()).toBeVisible();

      // The old rows are NOT dropped: they move to the inactive-scope section.
      const inactive = page.locator("details").filter({ hasText: ZH.inactiveTitle }).first();
      await expect(inactive).toBeVisible();
      await inactive.locator("summary").click();
      await expect(
        inactive.getByText(ZH.inactiveSource("Color", "Red"), { exact: true }),
      ).toBeVisible();
      await expect(
        inactive.getByText(ZH.inactiveSource("Color", "Blue"), { exact: true }),
      ).toBeVisible();
      await expect(inactive.getByText("1 项媒体")).toHaveCount(2);

      // Switching back restores them as active scopes (still never merged).
      await driver.selectOption({ label: "Color" });
      expect(await scopedMediaUrlInputs(page).count()).toBe(2);
      await expect(page.locator("summary").filter({ hasText: ZH.inactiveTitle })).toHaveCount(0);
      await expect(page.getByLabel("Red 1 的媒体 URL", { exact: true })).toHaveValue(
        RED_VALUE_URL,
      );
      await expect(page.getByLabel("Blue 1 的媒体 URL", { exact: true })).toHaveValue(
        BLUE_VALUE_URL,
      );

      // --- B. the selector thumbnail is a distinct field --------------------
      await selectTab(page, "variants");
      await page
        .getByLabel(ZH.presentation, { exact: true })
        .selectOption({ label: ZH.presentationImage });
      const thumbnail = page.getByLabel(ZH.thumbnail, { exact: true });
      await expect(thumbnail).toBeVisible();
      // The visible field label names it as a selector thumbnail, not gallery
      // media (the wrapping <label> also carries the fallback hint).
      await expect(thumbnail.locator("xpath=ancestor::label[1]")).toContainText(
        ZH.thumbnailLabel,
      );
      await thumbnail.fill(THUMBNAIL_URL);
      await page.screenshot({
        path: "test-results/selector-thumbnail-vs-gallery.png",
        fullPage: true,
      });

      // --- C. scoped media edits -------------------------------------------
      await selectTab(page, "media");
      expect(
        await scopedMediaUrlInputs(page).count(),
        "the selector thumbnail is not a gallery row",
      ).toBe(2);
      await expect(
        page.locator(`input[aria-label$="的媒体 URL"][value="${THUMBNAIL_URL}"]`),
      ).toHaveCount(0);

      await page.getByRole("button", { name: ZH.addValueMedia("Blue") }).click();
      const blueValueUrl = page.getByLabel("Blue 2 的媒体 URL", { exact: true });
      await expect(blueValueUrl).toBeVisible();
      await blueValueUrl.fill(VALUE_MEDIA_URL);

      await page.locator("summary").filter({ hasText: ZH.exactTitle }).first().click();
      await page
        .getByLabel(ZH.targetVariant, { exact: true })
        .selectOption({ label: "Blue / Small" });
      await page.getByRole("button", { name: ZH.addVariantMedia }).click();
      const variantUrl = page.getByLabel("Blue / Small 1 的媒体 URL", { exact: true });
      await expect(variantUrl).toBeVisible();
      await variantUrl.fill(VARIANT_MEDIA_URL);
      expect(await scopedMediaUrlInputs(page).count()).toBe(4);

      // Save.
      await page.locator(SAVE_BUTTON).click();
      await expect(page.getByText(ZH.saved)).toBeVisible({ timeout: 30_000 });

      // --- D. backend truth -------------------------------------------------
      const saved = await adminProduct(COLOR_SIZE_SLUG);
      const media = saved.media ?? [];

      // XOR: no media row ever carries both scopes.
      for (const row of media) {
        expect(
          [row.optionValueId, row.variantId].filter((value) => value !== null).length,
          `media ${row.id} (${row.url}) must have at most one scope`,
        ).toBeLessThanOrEqual(1);
      }

      const valueRow = media.find((row) => row.url === VALUE_MEDIA_URL);
      expect(valueRow, "the new option-value media row persisted").toBeTruthy();
      expect(valueRow!.optionValueId).toBe(blueValue.id);
      expect(valueRow!.variantId).toBeNull();

      const variantRow = media.find((row) => row.url === VARIANT_MEDIA_URL);
      expect(variantRow, "the new exact-variant media row persisted").toBeTruthy();
      expect(variantRow!.variantId).toBe(blueSmall.id);
      expect(variantRow!.optionValueId).toBeNull();

      // Not merged: two distinct rows, and the pre-existing value scopes are
      // untouched by the exact-variant override.
      expect(valueRow!.id).not.toBe(variantRow!.id);
      const redRow = media.find((row) => row.url === RED_VALUE_URL);
      expect(redRow!.optionValueId).toBe(redValue.id);
      expect(redRow!.variantId).toBeNull();

      expect(scopeSignature(saved)).toEqual(
        [
          ...beforeSignature,
          `value:${blueValue.id}|${VALUE_MEDIA_URL}`,
          `variant:${blueSmall.id}|${VARIANT_MEDIA_URL}`,
        ].sort(),
      );
      // The thumbnail round-tripped as an option-value field, not as media.
      expect(valueByLabel(optionByName(saved, "Color"), "Red").thumbnailUrl).toBe(
        THUMBNAIL_URL,
      );
      expect(optionByName(saved, "Color").presentation).toBe("IMAGE");
      // ...and it did NOT become gallery media: only the two rows we added.
      expect(media).toHaveLength((before.media ?? []).length + 2);
      expect(
        media.filter((row) => row.url === THUMBNAIL_URL),
        "the selector thumbnail never becomes a gallery row",
      ).toEqual([]);

      // --- E. restore through the same UI -----------------------------------
      await selectTab(page, "variants");
      // Clear the thumbnail FIRST: switching back to SWATCH hides the field,
      // and a hidden-but-set thumbnail would still be written by the save.
      await page.getByLabel(ZH.thumbnail, { exact: true }).fill("");
      await page
        .getByLabel(ZH.presentation, { exact: true })
        .selectOption({ label: ZH.presentationSwatch });
      await selectTab(page, "media");
      await mediaRow(page, "Blue 2 的媒体 URL")
        .getByRole("button", { name: ZH.removeMedia })
        .click();
      await page.locator("summary").filter({ hasText: ZH.exactTitle }).first().click();
      // The target-variant picker falls back to the first variant on remount,
      // so re-select the variant that owns the override before removing it.
      await page
        .getByLabel(ZH.targetVariant, { exact: true })
        .selectOption({ label: "Blue / Small" });
      await mediaRow(page, "Blue / Small 1 的媒体 URL")
        .getByRole("button", { name: ZH.removeMedia })
        .click();
      expect(await scopedMediaUrlInputs(page).count()).toBe(2);

      await page.locator(SAVE_BUTTON).click();
      await expect(page.getByText(ZH.saved)).toBeVisible({ timeout: 30_000 });

      const restored = await adminProduct(COLOR_SIZE_SLUG);
      expect(scopeSignature(restored), "the fixture is back to its seeded scopes").toEqual(
        beforeSignature,
      );
      expect(optionByName(restored, "Color").presentation).toBe(
        colorOption.presentation,
      );
      expect(valueByLabel(optionByName(restored, "Color"), "Red").thumbnailUrl).toBe(
        redValue.thumbnailUrl,
      );

      await stopErrors();
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupFailures = await restoreProductSnapshot(before);
      if (primaryError) {
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            [primaryError, ...cleanupFailures.map((message) => new Error(message))],
            "scoped-media assertion failed; cleanup also reported failures",
          );
        }
        throw primaryError;
      }
      if (cleanupFailures.length > 0) {
        throw new Error(`scoped-media cleanup failed: ${cleanupFailures.join("; ")}`);
      }
    }
  });
});

/**
 * The problem rail. Two contracts live here:
 *  - a scalar-only option change (the gallery-driver switch) must produce a
 *    patch the backend accepts. The backend validates each option upsert as a
 *    self-contained graph, so a delta that carried `values: []` for an active
 *    option used to be rejected with "Active option X must have at least one
 *    active value." — even though the merged graph was perfectly valid;
 *  - a genuinely broken graph shows up inside the sticky chrome, stays on
 *    screen after scrolling to the bottom of the form, and is repairable in
 *    one click.
 *
 * Both live in one test because the admin login throttle allows ten requests
 * per ten minutes per IP and the scenarios above already spend that budget.
 */
test.describe("Problem rail and patch validity", () => {
  test("saves a driver switch cleanly and repairs a broken graph from the sticky rail", async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const stopErrors = trackBrowserErrors(page);
    const before = await adminProduct(COLOR_SIZE_SLUG);
    const patchBodies: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PATCH" &&
        request.url().includes("/admin/products/")
      ) {
        patchBodies.push(request.postData() ?? "");
      }
    });
    let primaryError: unknown = null;

    try {
      await openEditorWithStoredSession(page, COLOR_SIZE_SLUG);

      // --- A. driver switch: a scalar-only option change must save ----------
      await selectTab(page, "media");
      await page
        .getByLabel(ZH.driverSelect, { exact: true })
        .selectOption({ label: "Size" });
      await page.locator(SAVE_BUTTON).click();
      await expect(page.getByText(ZH.saved)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("#pf-problem-rail")).toHaveCount(0);

      // Every active option in the delta carries an active value — exactly what
      // the backend's patch-only validation demands.
      const graphPatch = patchBodies.find((body) => body.includes("catalogGraph"));
      expect(graphPatch, "graph PATCH captured").toBeTruthy();
      const parsed = JSON.parse(graphPatch ?? "{}") as {
        catalogGraph?: {
          options?: {
            name: string;
            isActive: boolean;
            values: { isActive: boolean }[];
          }[];
        };
      };
      const options = parsed.catalogGraph?.options ?? [];
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        if (!option.isActive) continue;
        expect(
          option.values.some((value) => value.isActive),
          `active option ${option.name} carries an active value`,
        ).toBe(true);
      }
      const saved = await adminProduct(COLOR_SIZE_SLUG);
      expect(
        optionByName(saved, "Size").isMediaDriver,
        "the driver switch persisted",
      ).toBe(true);

      // --- B. broken graph: the rail stays visible and repairs in place -----
      await selectTab(page, "variants");
      const group = optionGroup(page, 1);
      await group.getByLabel("选项值 1 启用", { exact: true }).uncheck();
      await group.getByLabel("选项值 2 启用", { exact: true }).uncheck();
      await page.locator(SAVE_BUTTON).click();

      const rail = page.locator("#pf-problem-rail");
      await expect(rail).toContainText("1 个问题待处理");
      await expect(rail).toContainText("至少需要一个启用的选项值");

      // The rail rides inside the sticky chrome: it is still on screen after
      // scrolling to the very bottom of the form.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(rail).toBeInViewport();

      // One click repairs the graph and clears the rail.
      await rail.getByRole("button", { name: "查看" }).click();
      await rail.getByRole("button", { name: "停用这个选项" }).click();
      await expect(page.locator("#pf-problem-rail")).toHaveCount(0);
      await expect(
        group.getByLabel("选项 1 启用", { exact: true }),
      ).not.toBeChecked();

      await stopErrors();
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupFailures = await restoreProductSnapshot(before);
      if (primaryError) {
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            [primaryError, ...cleanupFailures.map((message) => new Error(message))],
            "problem-rail assertions failed; cleanup also reported failures",
          );
        }
        throw primaryError;
      }
      if (cleanupFailures.length > 0) {
        throw new Error(`problem-rail cleanup failed: ${cleanupFailures.join("; ")}`);
      }
    }
  });
});

test.describe("Preview truth", () => {
  test("saved DRAFT/DISABLED request no public iframe; saved ACTIVE uses the server slug", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const stopErrors = trackBrowserErrors(page);
    const pdpRequests = auditPdpRequests(page);
    const before = await adminProduct(COLOR_SIZE_SLUG);
    expect(before.status).toBe("ACTIVE");
    const nonce = Date.now() % 1_000_000;
    const unsavedSlug = `${COLOR_SIZE_SLUG}-unsaved-${nonce}`;

    try {
      await openEditor(page, COLOR_SIZE_SLUG);
      await selectTab(page, "preview");

      // --- saved + ACTIVE: the real page, under the SERVER slug -------------
      await expect(savedPageBlock(page).getByText(ZH.savedActiveNote)).toBeVisible();
      const savedLink = page.getByRole("link", { name: ZH.openSaved });
      await expect(savedLink).toHaveAttribute("href", `/products/${COLOR_SIZE_SLUG}`);
      const iframes = page.locator("#pf-panel-preview iframe");
      await expect(iframes).toHaveCount(2);
      for (const index of [0, 1]) {
        expect(await iframes.nth(index).getAttribute("src")).toMatch(
          new RegExp(`^/products/${COLOR_SIZE_SLUG}\\?_preview=`),
        );
      }
      await expect(savedPageBlock(page).getByText(ZH.unsavedNote)).toHaveCount(0);

      // Load the iframes and prove the storefront page really is requested.
      await iframes.first().scrollIntoViewIfNeeded();
      await expect
        .poll(
          () => pdpRequests().some((path) => path.startsWith(`/products/${COLOR_SIZE_SLUG}`)),
          { timeout: 15_000 },
        )
        .toBe(true);

      // --- unsaved slug change: notice only, the preview keeps the SAVED url -
      await selectTab(page, "seo");
      await page.locator("#pf-slug").fill(unsavedSlug);
      await selectTab(page, "preview");
      await expect(savedPageBlock(page).getByText(ZH.unsavedNote)).toBeVisible();
      await expect(savedLink).toHaveAttribute("href", `/products/${COLOR_SIZE_SLUG}`);
      await expect(iframes).toHaveCount(2);
      for (const index of [0, 1]) {
        const src = (await iframes.nth(index).getAttribute("src"))!;
        expect(
          src.startsWith(`/products/${COLOR_SIZE_SLUG}?`),
          `iframe src must keep the saved slug, got ${src}`,
        ).toBe(true);
        expect(src).not.toContain(unsavedSlug);
      }
      expect(
        pdpRequests().filter((path) => path.includes(unsavedSlug)),
        "the unsaved slug is never requested",
      ).toEqual([]);

      // --- unsaved status change: still the saved ACTIVE page, plus notice ---
      await page.locator("#pf-status").selectOption("DISABLED");
      await selectTab(page, "preview");
      await expect(savedPageBlock(page).getByText(ZH.savedActiveNote)).toBeVisible();
      await expect(savedPageBlock(page).getByText(ZH.unsavedNote)).toBeVisible();
      await expect(savedPageBlock(page).getByText(ZH.inactiveSavedNote)).toHaveCount(0);
      await expect(savedLink).toHaveAttribute("href", `/products/${COLOR_SIZE_SLUG}`);
      await expect(iframes).toHaveCount(2);
      expect(
        pdpRequests().filter((path) => path.includes(unsavedSlug)),
        "an unsaved status change never changes the previewed url",
      ).toEqual([]);

      // Nothing was saved: the server row is untouched.
      const untouched = await adminProduct(COLOR_SIZE_SLUG);
      expect(untouched.slug).toBe(COLOR_SIZE_SLUG);
      expect(untouched.status).toBe("ACTIVE");

      // --- saved DISABLED: never requests a public iframe -------------------
      await adminPatch(before.id, { status: "DISABLED" });
      const beforeDisabledReload = pdpRequests().length;
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("tablist")).toBeVisible();
      await selectTab(page, "preview");
      await expect(savedPageBlock(page).getByText(ZH.inactiveSavedNote)).toBeVisible();
      await expect(page.locator("#pf-panel-preview iframe")).toHaveCount(0);
      await expect(
        page.locator('#pf-panel-preview a[href^="/products/"]'),
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: ZH.refreshPreview })).toHaveCount(0);
      // The baseline is before reload; this covers reload, preview activation,
      // network settling, and the explicit observation window.
      expect(pdpRequests().length, "DISABLED reload made no public request").toBe(
        beforeDisabledReload,
      );
      await page.waitForTimeout(1_500);
      expect(
        pdpRequests().length,
        "no storefront page may be requested for a DISABLED product",
      ).toBe(beforeDisabledReload);

      await stopErrors();
    } finally {
      const current = await adminProduct(COLOR_SIZE_SLUG).catch(() => null);
      if (current && current.status !== before.status) {
        await adminPatch(current.id, { status: before.status });
      }
      const after = await adminProduct(COLOR_SIZE_SLUG);
      expect(after.status).toBe(before.status);
      expect(after.slug).toBe(COLOR_SIZE_SLUG);
    }
  });
});

test.describe("Localization", () => {
  test("zh default has no bilingual labels; the en toggle renders coherent English", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const stopErrors = trackBrowserErrors(page);
    await openEditor(page, COLOR_SIZE_SLUG);

    const assertLang = async (lang: "zh" | "en"): Promise<void> => {
      const expected = lang === "zh" ? ZH : EN;
      const other = lang === "zh" ? EN : ZH;
      await expect(page.getByRole("tablist")).toHaveAttribute(
        "aria-label",
        expected.tabsAria,
      );
      for (const key of TAB_KEYS) {
        const label = (await tab(page, key, lang).innerText()).trim();
        expect(label, `${key} label (${lang})`).toBe(expected.tabs[key]);
        // No bilingual concatenation: the other language's label is absent.
        expect(label).not.toContain(other.tabs[key]);
      }
      await expect(page.locator("#pf-status")).toHaveValue("ACTIVE");
      const statusOptions = await page
        .locator("#pf-status option")
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).label));
      expect(statusOptions).toEqual([
        expected.statusDraft,
        expected.statusActive,
        expected.statusDisabled,
      ]);
      await expect(page.locator(SAVE_BUTTON)).toHaveText(expected.saveChanges);
    };

    // Default is zh (fresh context => empty localStorage).
    await assertLang("zh");
    // Migrated sections render their zh headings, not a zh+en concatenation.
    await selectTab(page, "media");
    await expect(page.getByText(ZH.sharedGallery).first()).toBeVisible();
    await expect(page.getByText(EN.sharedGallery)).toHaveCount(0);
    await selectTab(page, "variants");
    await expect(page.getByText(ZH.typedVariantsTitle, { exact: true })).toBeVisible();

    // Toggle to en.
    await page.getByRole("button", { name: "Switch language" }).click();
    await assertLang("en");
    await selectTab(page, "media", "en");
    await expect(page.getByText(EN.sharedGallery).first()).toBeVisible();
    await expect(page.getByText(ZH.sharedGallery)).toHaveCount(0);
    await selectTab(page, "variants", "en");
    await expect(page.getByText(EN.typedVariantsTitle, { exact: true })).toBeVisible();

    // And back: the toggle round-trips without mixing dictionaries.
    await page.getByRole("button", { name: "Switch language" }).click();
    await assertLang("zh");

    await stopErrors();
  });
});
