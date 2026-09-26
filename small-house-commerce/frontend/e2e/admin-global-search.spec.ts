import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { assertE2EDatabaseUrl } from "../src/lib/e2e-guard";

const API = "http://127.0.0.1:3210/api/v1";
const WEB = "http://localhost:3211";
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.E2E_PG_USER ?? "postgres"}:${process.env.E2E_PG_PASSWORD ?? "postgres"}@localhost:5432/${process.env.E2E_TEST_DB ?? "small_house_variant_test"}?schema=public`;
const BACKEND_DIR = resolve(__dirname, "../../backend");
const SCREENSHOTS = resolve(__dirname, "../screenshots");
const PASSWORD = "E2eAdminPass123!";
const ACCOUNTS = {
  admin: "e2e-admin@smallhouse.test",
  warehouse: "e2e-warehouse@smallhouse.test",
  optimizer: "e2e-optimizer@smallhouse.test",
} as const;

type AccountEmail = (typeof ACCOUNTS)[keyof typeof ACCOUNTS];

interface LoginTokens {
  accessToken: string;
  refreshToken: string;
}

interface ProductJson {
  id: string;
  name: string;
  slug: string;
  productCode: string;
  categoryId: string;
  status: "DRAFT" | "ACTIVE" | "DISABLED";
  variants: {
    id: string;
    name: string;
    sku: {
      id: string;
      skuCode: string;
      status: "ACTIVE" | "DISABLED";
      price: string | null;
    } | null;
  }[];
}

interface OrderJson {
  id: string;
  orderNumber: string;
  customerId: string;
  customer: {
    id: string;
    name: string | null;
    normalizedPhone: string;
    email: string | null;
  };
  items: { id: string; quantity: number }[];
  shipments: {
    id: string;
    trackingNumber: string | null;
    status: string;
  }[];
}

interface ProductHit {
  kind: "PRODUCT";
  productId: string;
  name: string;
  productCode: string | null;
  status: string;
  matchedField: "PRODUCT_CODE" | "SKU_CODE" | "NAME" | "SLUG";
  matchedText: string;
  matchedSku: {
    skuId: string;
    skuCode: string;
    skuStatus: string;
    price: string | null;
    availableInventory: number;
  } | null;
}

interface OrderHit {
  kind: "ORDER";
  orderId: string;
  orderNumber: string;
  matchedField: "ORDER_NUMBER" | "PHONE" | "CUSTOMER_NAME";
  matchedText: string;
}

interface CustomerHit {
  kind: "CUSTOMER";
  customerId: string;
  name: string | null;
  normalizedPhone: string;
  email: string | null;
  matchedField: "PHONE" | "EMAIL" | "NAME";
  matchedText: string;
}

interface ShipmentHit {
  kind: "SHIPMENT";
  shipmentId: string;
  trackingNumber: string;
  orderId: string;
  matchedField: "TRACKING_NUMBER";
  matchedText: string;
}

interface SearchResponse {
  query: string;
  groups: {
    products?: { items: ProductHit[]; hasMore: boolean };
    orders?: { items: OrderHit[]; hasMore: boolean };
    customers?: { items: CustomerHit[]; hasMore: boolean };
    shipments?: { items: ShipmentHit[]; hasMore: boolean };
  };
}

interface SearchFixtures {
  suffix: string;
  rankToken: string;
  literalToken: string;
  limitToken: string;
  uiToken: string;
  productOrder: string[];
  dedupeProductId: string;
  inventoryProductId: string;
  inventorySkuId: string;
  literalProductId: string;
  limitExactProductId: string;
  orderRankPhone: string;
  orderOrder: string[];
  customerOrderForPhone: string[];
  emailToken: string;
  emailCustomerOrder: string[];
  trackingToken: string;
  shipmentExactIds: string[];
  shipmentPrefixId: string;
  shipmentContainsId: string;
  customerPageName: string;
  customerPageQuery: string;
  shipmentOrderId: string;
  shipmentUiTracking: string;
}

let api: APIRequestContext;
const tokens = new Map<AccountEmail, LoginTokens>();
const temporaryProductIds: string[] = [];
let secondWarehouseName: string | null = null;
let fixtures: SearchFixtures | null = null;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function login(email: AccountEmail): Promise<LoginTokens> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const response = await api.post(`${API}/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(
    response.ok(),
    `login ${email}: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  const body = (await response.json()) as LoginTokens;
  tokens.set(email, body);
  return body;
}

async function adminFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    data?: unknown;
    email?: AccountEmail;
  } = {},
): Promise<T> {
  const { accessToken } = await login(options.email ?? ACCOUNTS.admin);
  const response = await api.fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers: authHeaders(accessToken),
    data: options.data,
  });
  expect(
    response.ok(),
    `${options.method ?? "GET"} ${path}: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()) as T;
}

async function search(
  query: string,
  limit = 20,
  email: AccountEmail = ACCOUNTS.admin,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return adminFetch<SearchResponse>(`/admin/search?${params}`, { email });
}

async function productBySlug(slug: string): Promise<ProductJson> {
  const params = new URLSearchParams({ search: slug, pageSize: "100" });
  const page = await adminFetch<{ items: ProductJson[] }>(
    `/admin/products?${params}`,
  );
  const row = page.items.find((item) => item.slug === slug);
  expect(row, `product ${slug} exists`).toBeTruthy();
  return adminFetch<ProductJson>(`/admin/products/${row!.id}`);
}

interface CreateProductOptions {
  name: string;
  slug: string;
  categoryId: string;
  status?: "DRAFT" | "ACTIVE" | "DISABLED";
  skus?: {
    code: string;
    status?: "ACTIVE" | "DISABLED";
    price?: number;
  }[];
}

async function createProduct(
  options: CreateProductOptions,
): Promise<ProductJson> {
  const created = await adminFetch<ProductJson>("/admin/products", {
    method: "POST",
    data: {
      name: options.name,
      slug: options.slug,
      categoryId: options.categoryId,
      status: options.status ?? "DRAFT",
      variants: (options.skus ?? []).map((sku, index) => ({
        name: `Variant ${index + 1}`,
        position: index,
        sku: {
          skuCode: sku.code,
          status: sku.status ?? "ACTIVE",
          ...(sku.price === undefined ? {} : { price: sku.price }),
        },
      })),
    },
  });
  temporaryProductIds.push(created.id);
  return adminFetch<ProductJson>(`/admin/products/${created.id}`);
}

async function createOrder(input: {
  skuId: string;
  name: string;
  phone: string;
  email: string;
}): Promise<OrderJson> {
  const checkout = await api.post(`${API}/storefront/orders`, {
    data: {
      customer: {
        name: input.name,
        phone: input.phone,
        province: "Metro Manila",
        city: "Quezon City",
        barangay: "Bago Bantay",
        postalCode: "1105",
        streetAddress: "1 E2E Search Street",
        landmark: "Search fixture",
      },
      items: [{ skuId: input.skuId, quantity: 1 }],
      attribution: { sourceType: "ORGANIC" },
      preferredDeliveryDate: null,
    },
  });
  expect(
    checkout.ok(),
    `storefront checkout: ${checkout.status()} ${await checkout.text()}`,
  ).toBeTruthy();
  const created = (await checkout.json()) as { orderNumber: string };
  const params = new URLSearchParams({
    search: created.orderNumber,
    pageSize: "100",
  });
  const list = await adminFetch<{ items: { id: string; orderNumber: string }[] }>(
    `/admin/orders?${params}`,
  );
  const row = list.items.find(
    (item) => item.orderNumber === created.orderNumber,
  );
  expect(row, `order ${created.orderNumber} exists`).toBeTruthy();
  const detail = await adminFetch<OrderJson>(`/admin/orders/${row!.id}`);
  await adminFetch(`/admin/customers/${detail.customerId}`, {
    method: "PATCH",
    data: { email: input.email },
  });
  return adminFetch<OrderJson>(`/admin/orders/${row!.id}`);
}

async function confirmAndShip(
  order: OrderJson,
  trackingNumber: string,
): Promise<string> {
  await adminFetch(`/admin/orders/${order.id}/confirm`, { method: "POST" });
  const shipped = await adminFetch<{ shipmentId: string }>(
    `/admin/orders/${order.id}/ship`,
    {
      method: "POST",
      data: {
        carrier: "LBC",
        trackingNumber,
        items: order.items.map((item) => ({
          orderItemId: item.id,
          quantity: item.quantity,
        })),
      },
    },
  );
  return shipped.shipmentId;
}

function runDatabaseMutation(data: {
  productCodes: { id: string; productCode: string }[];
  orderNumbers: { id: string; orderNumber: string }[];
  inventory: { skuId: string; firstOnHand: number; secondOnHand: number };
  secondWarehouseName: string;
}): void {
  assertE2EDatabaseUrl(DATABASE_URL);
  execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "-e",
      `
        import { PrismaPg } from '@prisma/adapter-pg';
        import { PrismaClient } from './src/generated/prisma/client.ts';
        import { assertE2EDatabaseUrl } from '../frontend/src/lib/e2e-guard.ts';
        void (async () => {
          const input = JSON.parse(process.env.E2E_SEARCH_MUTATION!);
          assertE2EDatabaseUrl(process.env.DATABASE_URL!);
          const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
          try {
          for (const row of input.productCodes) {
            await prisma.product.update({ where: { id: row.id }, data: { productCode: row.productCode } });
          }
          for (const row of input.orderNumbers) {
            await prisma.order.update({ where: { id: row.id }, data: { orderNumber: row.orderNumber } });
          }
          const first = await prisma.warehouse.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
          const second = await prisma.warehouse.create({
            data: {
              name: input.secondWarehouseName,
              country: 'PH',
              province: 'Cebu',
              city: 'Cebu City',
            },
          });
          await prisma.inventory.upsert({
            where: { skuId_warehouseId: { skuId: input.inventory.skuId, warehouseId: first.id } },
            create: { skuId: input.inventory.skuId, warehouseId: first.id, onHand: input.inventory.firstOnHand, reserved: 0 },
            update: { onHand: input.inventory.firstOnHand, reserved: 0 },
          });
          await prisma.inventory.create({
            data: { skuId: input.inventory.skuId, warehouseId: second.id, onHand: input.inventory.secondOnHand, reserved: 0 },
          });
          } finally {
            await prisma.$disconnect();
          }
        })().catch((error) => {
          console.error(error);
          process.exitCode = 1;
        });
      `,
    ],
    {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        DATABASE_URL,
        E2E_SEARCH_MUTATION: JSON.stringify(data),
      },
      stdio: "pipe",
    },
  );
}

function removeSecondWarehouse(name: string): void {
  assertE2EDatabaseUrl(DATABASE_URL);
  execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "-e",
      `
        import { PrismaPg } from '@prisma/adapter-pg';
        import { PrismaClient } from './src/generated/prisma/client.ts';
        import { assertE2EDatabaseUrl } from '../frontend/src/lib/e2e-guard.ts';
        void (async () => {
          assertE2EDatabaseUrl(process.env.DATABASE_URL!);
          const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
          try {
            await prisma.warehouse.deleteMany({ where: { name: process.env.E2E_WAREHOUSE_NAME! } });
          } finally {
            await prisma.$disconnect();
          }
        })().catch((error) => {
          console.error(error);
          process.exitCode = 1;
        });
      `,
    ],
    {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL, E2E_WAREHOUSE_NAME: name },
      stdio: "pipe",
    },
  );
}

function phoneFactory(): (index: number) => string {
  const base = Number(String(Date.now()).slice(-7));
  return (index) =>
    `0917${String((base + index * 97) % 10_000_000).padStart(7, "0")}`;
}

async function prepareFixtures(): Promise<SearchFixtures> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toLowerCase();
  const rankToken = `gs${suffix}`;
  const literalToken = "%_\\";
  const limitToken = `lim${suffix}`;
  const uiToken = `ui${suffix}`;
  const secondName = `E2E Search Warehouse ${suffix}`;
  secondWarehouseName = secondName;
  const seeded = await productBySlug("e2e-color-size");
  const seededSku = seeded.variants.find(
    (variant) => variant.sku?.skuCode === "E2E-CS-BLUE-M",
  )?.sku;
  expect(seededSku, "seeded order SKU exists").toBeTruthy();
  const categoryId = seeded.categoryId;

  const codeExact = await createProduct({
    name: rankToken,
    slug: `e2e-gs-code-${suffix}`,
    categoryId,
    status: "DRAFT",
    skus: [
      { code: `${rankToken}-A`, price: 100 },
      { code: `${rankToken}-B`, price: 101 },
    ],
  });
  const skuExact = await createProduct({
    name: `SKU exact ${suffix}`,
    slug: `e2e-gs-sku-${suffix}`,
    categoryId,
    status: "DISABLED",
    skus: [{ code: rankToken, status: "DISABLED" }],
  });
  const nameExact = await createProduct({
    name: rankToken,
    slug: `e2e-gs-name-${suffix}`,
    categoryId,
    skus: [{ code: `NAME-${suffix}`, price: 102 }],
  });
  const slugExact = await createProduct({
    name: `Slug exact ${suffix}`,
    slug: rankToken,
    categoryId,
    skus: [{ code: `SLUG-${suffix}`, price: 103 }],
  });
  const codePrefix = await createProduct({
    name: `Code prefix ${suffix}`,
    slug: `e2e-gs-code-prefix-${suffix}`,
    categoryId,
  });
  const skuPrefix = await createProduct({
    name: `SKU prefix ${suffix}`,
    slug: `e2e-gs-sku-prefix-${suffix}`,
    categoryId,
    skus: [{ code: `${rankToken}-SKU-PREFIX`, price: 104 }],
  });
  const namePrefix = await createProduct({
    name: `${rankToken} name prefix`,
    slug: `e2e-gs-name-prefix-${suffix}`,
    categoryId,
  });
  const slugPrefix = await createProduct({
    name: `Slug prefix ${suffix}`,
    slug: `${rankToken}-slug-prefix`,
    categoryId,
  });
  const codeContains = await createProduct({
    name: `Code contains ${suffix}`,
    slug: `e2e-gs-code-contains-${suffix}`,
    categoryId,
  });
  const skuContains = await createProduct({
    name: `SKU contains ${suffix}`,
    slug: `e2e-gs-sku-contains-${suffix}`,
    categoryId,
    skus: [{ code: `X-${rankToken}-SKU`, price: 105 }],
  });
  const nameContains = await createProduct({
    name: `X ${rankToken} name contains`,
    slug: `e2e-gs-name-contains-${suffix}`,
    categoryId,
  });
  const slugContains = await createProduct({
    name: `Slug contains ${suffix}`,
    slug: `x-${rankToken}-slug`,
    categoryId,
  });
  const literal = await createProduct({
    name: literalToken,
    slug: `e2e-gs-literal-${suffix}`,
    categoryId,
  });
  await createProduct({
    name: uiToken,
    slug: `e2e-gs-ui-${suffix}`,
    categoryId,
  });
  const limitExact = await createProduct({
    name: `Limit exact ${suffix}`,
    slug: `e2e-gs-limit-exact-${suffix}`,
    categoryId,
    skus: [{ code: limitToken, price: 106 }],
  });
  for (let index = 1; index <= 21; index += 1) {
    await createProduct({
      name: `Candidate ${index} x ${limitToken} y`,
      slug: `e2e-gs-limit-${suffix}-${index}`,
      categoryId,
      skus: [{ code: `LIMIT-${suffix}-${index}`, price: 200 + index }],
    });
  }

  const nextPhone = phoneFactory();
  const orderInputs = [
    { name: `Order exact ${suffix}`, phone: nextPhone(1) },
    { name: `Phone exact ${suffix}`, phone: nextPhone(2) },
    { name: `Name exact ${suffix}`, phone: nextPhone(3) },
    { name: `Order prefix ${suffix}`, phone: nextPhone(4) },
    { name: `Order contains ${suffix}`, phone: nextPhone(5) },
    { name: `Name prefix ${suffix}`, phone: nextPhone(6) },
    { name: `Name contains ${suffix}`, phone: nextPhone(7) },
    { name: `Email holder ${suffix}`, phone: nextPhone(8) },
    { name: `Email-name holder ${suffix}`, phone: nextPhone(9) },
    { name: `${uiToken} Customer`, phone: nextPhone(10) },
  ];
  const orders: OrderJson[] = [];
  for (const [index, input] of orderInputs.entries()) {
    orders.push(
      await createOrder({
        skuId: seededSku!.id,
        name: input.name,
        phone: input.phone,
        email: `search-${suffix}-${index + 1}@e2e.test`,
      }),
    );
  }
  const orderRankPhone = orders[1]!.customer.normalizedPhone.replace("+63", "0");
  const emailToken = `rank-${suffix}@e2e.test`;
  await adminFetch(`/admin/customers/${orders[2]!.customerId}`, {
    method: "PATCH",
    data: { name: orderRankPhone },
  });
  await adminFetch(`/admin/customers/${orders[5]!.customerId}`, {
    method: "PATCH",
    data: { name: `${orderRankPhone} Prefix` },
  });
  await adminFetch(`/admin/customers/${orders[6]!.customerId}`, {
    method: "PATCH",
    data: { name: `X ${orderRankPhone} Contains` },
  });
  await adminFetch(`/admin/customers/${orders[7]!.customerId}`, {
    method: "PATCH",
    data: { email: emailToken },
  });
  await adminFetch(`/admin/customers/${orders[8]!.customerId}`, {
    method: "PATCH",
    data: { name: emailToken },
  });

  const trackingToken = `TRACK-${suffix}`;
  const shipmentExactIds = [
    await confirmAndShip(orders[0]!, trackingToken),
    await confirmAndShip(orders[1]!, trackingToken),
  ];
  const shipmentPrefixId = await confirmAndShip(
    orders[2]!,
    `${trackingToken}-PREFIX`,
  );
  const shipmentContainsId = await confirmAndShip(
    orders[3]!,
    `X-${trackingToken}-CONTAINS`,
  );
  const shipmentUiTracking = `${uiToken}-TRACK`;
  await confirmAndShip(orders[9]!, shipmentUiTracking);

  runDatabaseMutation({
    productCodes: [
      { id: codeExact.id, productCode: rankToken },
      { id: codePrefix.id, productCode: `${rankToken}-PC-PREFIX` },
      { id: codeContains.id, productCode: `X-${rankToken}-PC` },
      { id: limitExact.id, productCode: limitToken },
    ],
    orderNumbers: [
      { id: orders[0]!.id, orderNumber: orderRankPhone },
      { id: orders[3]!.id, orderNumber: `${orderRankPhone}-PREFIX` },
      { id: orders[4]!.id, orderNumber: `X-${orderRankPhone}-CONTAINS` },
      { id: orders[9]!.id, orderNumber: `${uiToken}-ORDER` },
    ],
    inventory: {
      skuId: skuExact.variants[0]!.sku!.id,
      firstOnHand: 8,
      secondOnHand: 4,
    },
    secondWarehouseName: secondName,
  });
  expect(await adminFetch<ProductJson>(`/admin/products/${codeExact.id}`)).toMatchObject({
    id: codeExact.id,
    name: rankToken,
    productCode: rankToken,
  });

  return {
    suffix,
    rankToken,
    literalToken,
    limitToken,
    uiToken,
    productOrder: [
      codeExact.id,
      skuExact.id,
      nameExact.id,
      slugExact.id,
      codePrefix.id,
      skuPrefix.id,
      namePrefix.id,
      slugPrefix.id,
      codeContains.id,
      skuContains.id,
      nameContains.id,
      slugContains.id,
    ],
    dedupeProductId: codeExact.id,
    inventoryProductId: skuExact.id,
    inventorySkuId: skuExact.variants[0]!.sku!.id,
    literalProductId: literal.id,
    limitExactProductId: limitExact.id,
    orderRankPhone,
    orderOrder: [
      orders[0]!.id,
      orders[1]!.id,
      orders[2]!.id,
      orders[3]!.id,
      orders[5]!.id,
      orders[4]!.id,
      orders[6]!.id,
    ],
    customerOrderForPhone: [
      orders[1]!.customerId,
      orders[2]!.customerId,
      orders[5]!.customerId,
      orders[6]!.customerId,
    ],
    emailToken,
    emailCustomerOrder: [orders[7]!.customerId, orders[8]!.customerId],
    trackingToken,
    shipmentExactIds,
    shipmentPrefixId,
    shipmentContainsId,
    customerPageName: `Email holder ${suffix}`,
    customerPageQuery: emailToken,
    shipmentOrderId: orders[9]!.id,
    shipmentUiTracking,
  };
}

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
    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
    expect(hydration, `hydration warnings:\n${hydration.join("\n")}`).toEqual([]);
  };
}

async function openSession(
  page: Page,
  email: AccountEmail,
  path = "/admin/search",
): Promise<void> {
  const session = await login(email);
  await page.addInitScript((refreshToken) => {
    window.localStorage.setItem("sh_admin_refresh", refreshToken);
  }, session.refreshToken);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page).not.toHaveURL(/\/admin\/login/);
}

async function openPalette(page: Page, query: string): Promise<void> {
  await page.keyboard.press("Control+K");
  const input = page.getByRole("combobox", {
    name: "搜索商品、订单、客户和物流",
  });
  await expect(input).toBeFocused();
  await input.fill(query);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.client + 1);
  expect(widths.body).toBeLessThanOrEqual(widths.client + 1);
}

const errorStops = new WeakMap<Page, () => void>();

test.describe.serial("Admin global search real stack", () => {
  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({
      extraHTTPHeaders: {
        // Keep this spec's three role logins out of unrelated E2E files' shared
        // loopback auth-throttle bucket. The real test server trusts one proxy.
        "X-Forwarded-For": "127.0.0.2",
      },
    });
  });

  test.beforeEach(async ({ page }) => {
    errorStops.set(page, trackBrowserErrors(page));
  });

  test.afterEach(async ({ page }) => {
    errorStops.get(page)?.();
  });

  test.afterAll(async () => {
    const failures: string[] = [];
    for (const productId of [...temporaryProductIds].reverse()) {
      try {
        const { accessToken } = await login(ACCOUNTS.admin);
        const response = await api.delete(`${API}/admin/products/${productId}`, {
          headers: authHeaders(accessToken),
        });
        if (![200, 204, 404].includes(response.status())) {
          failures.push(
            `delete ${productId}: ${response.status()} ${await response.text()}`,
          );
        }
      } catch (error) {
        failures.push(`delete ${productId}: ${String(error)}`);
      }
    }
    if (secondWarehouseName !== null) {
      try {
        removeSecondWarehouse(secondWarehouseName);
      } catch (error) {
        failures.push(`delete ${secondWarehouseName}: ${String(error)}`);
      }
    }
    await api?.dispose();
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("guards loopback origins and the exact disposable database before creating per-run fixtures", async ({}, testInfo) => {
    test.setTimeout(240_000);
    const database = decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1));
    expect(new URL(API).origin).toBe("http://127.0.0.1:3210");
    expect(new URL(String(testInfo.project.use.baseURL)).origin).toBe(WEB);
    expect(assertE2EDatabaseUrl(DATABASE_URL)).toEqual({
      database: "small_house_variant_test",
      host: "localhost",
      port: "5432",
    });
    expect(database).toBe("small_house_variant_test");

    fixtures = await prepareFixtures();
  });

  test("ranks and deduplicates real PostgreSQL results before LIMIT with literal wildcard safety", async () => {
    const fx = fixtures!;
    const productResults = await search(fx.rankToken);
    const productItems = productResults.groups.products?.items ?? [];
    expect(
      productItems.map((item) => item.productId),
      JSON.stringify(
        productItems.map((item) => ({
          productId: item.productId,
          productCode: item.productCode,
          name: item.name,
          matchedField: item.matchedField,
          matchedText: item.matchedText,
        })),
        null,
        2,
      ),
    ).toEqual(fx.productOrder);
    expect(productResults.groups.products?.items.map((item) => item.matchedField)).toEqual([
      "PRODUCT_CODE",
      "SKU_CODE",
      "NAME",
      "SLUG",
      "PRODUCT_CODE",
      "SKU_CODE",
      "NAME",
      "SLUG",
      "PRODUCT_CODE",
      "SKU_CODE",
      "NAME",
      "SLUG",
    ]);
    expect(
      productResults.groups.products?.items.filter(
        (item) => item.productId === fx.dedupeProductId,
      ),
    ).toHaveLength(1);
    const inventoryHit = productResults.groups.products?.items.find(
      (item) => item.productId === fx.inventoryProductId,
    );
    expect(inventoryHit).toMatchObject({
      status: "DISABLED",
      matchedSku: {
        skuId: fx.inventorySkuId,
        skuStatus: "DISABLED",
        price: null,
        availableInventory: 12,
      },
    });
    expect(productResults.groups.products?.items[0]?.status).toBe("DRAFT");

    const orderResults = await search(fx.orderRankPhone);
    expect(orderResults.groups.orders?.items.map((item) => item.orderId)).toEqual(
      fx.orderOrder,
    );
    expect(orderResults.groups.orders?.items.map((item) => item.matchedField)).toEqual([
      "ORDER_NUMBER",
      "PHONE",
      "CUSTOMER_NAME",
      "ORDER_NUMBER",
      "CUSTOMER_NAME",
      "ORDER_NUMBER",
      "CUSTOMER_NAME",
    ]);

    const customerPhone = await search(fx.orderRankPhone);
    expect(
      customerPhone.groups.customers?.items
        .slice(0, 4)
        .map((item) => item.customerId),
    ).toEqual(fx.customerOrderForPhone);
    expect(
      customerPhone.groups.customers?.items
        .slice(0, 4)
        .map((item) => item.matchedField),
    ).toEqual(["PHONE", "NAME", "NAME", "NAME"]);
    const customerEmail = await search(fx.emailToken);
    expect(
      customerEmail.groups.customers?.items.map((item) => item.customerId),
    ).toEqual(fx.emailCustomerOrder);
    expect(
      customerEmail.groups.customers?.items.map((item) => item.matchedField),
    ).toEqual(["EMAIL", "NAME"]);

    const shipmentResults = await search(fx.trackingToken);
    const shipments = shipmentResults.groups.shipments?.items ?? [];
    expect(new Set(shipments.slice(0, 2).map((item) => item.shipmentId))).toEqual(
      new Set(fx.shipmentExactIds),
    );
    expect(shipments[0]?.trackingNumber).toBe(fx.trackingToken);
    expect(shipments[1]?.trackingNumber).toBe(fx.trackingToken);
    expect(shipments[2]?.shipmentId).toBe(fx.shipmentPrefixId);
    expect(shipments[3]?.shipmentId).toBe(fx.shipmentContainsId);

    const literal = await search(fx.literalToken);
    expect(literal.groups.products?.items.map((item) => item.productId)).toEqual([
      fx.literalProductId,
    ]);
    const limited = await search(fx.limitToken);
    expect(limited.groups.products?.items).toHaveLength(20);
    expect(limited.groups.products?.items[0]?.productId).toBe(
      fx.limitExactProductId,
    );
    expect(limited.groups.products?.hasMore).toBe(true);
  });

  test("navigates every real destination from the palette and captures the release screenshots", async ({ page }) => {
    test.setTimeout(180_000);
    const fx = fixtures!;
    await openSession(page, ACCOUNTS.admin, "/admin/products");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openPalette(page, fx.uiToken);
    const dialog = page.getByRole("dialog", { name: "全局搜索" });
    for (const heading of ["商品", "订单", "客户", "物流"]) {
      await expect(dialog.getByRole("heading", { name: heading })).toBeVisible();
    }
    const triggerBox = await page
      .getByRole("button", { name: "全局搜索", exact: true })
      .boundingBox();
    expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(420);
    expect(triggerBox?.width ?? 1000).toBeLessThanOrEqual(520);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: resolve(SCREENSHOTS, "phase-b-global-search-1440.png"),
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({
      path: resolve(SCREENSHOTS, "phase-b-global-search-1920.png"),
    });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/products\/[^/]+\/edit/);

    await openPalette(page, "E2E-CS-BLUE-M");
    await dialog
      .getByRole("option")
      .filter({ hasText: "E2E-CS-BLUE-M" })
      .click();
    await expect(page).toHaveURL(
      /section=variants&sku=E2E-CS-BLUE-M/,
    );
    await expect(
      page.getByRole("tab", { name: "选项、价格与库存" }),
    ).toHaveAttribute("aria-selected", "true");
    const skuInput = page.getByLabel("Blue / Medium 的 SKU 编码");
    await expect(skuInput).toBeFocused();
    await page.screenshot({
      path: resolve(
        SCREENSHOTS,
        "phase-b-global-search-sku-deeplink-1920.png",
      ),
    });

    await openPalette(page, fx.customerPageQuery);
    await dialog
      .getByRole("option")
      .filter({ hasText: fx.customerPageName })
      .click();
    await expect(page).toHaveURL(/\/admin\/customers\/[^/]+$/);
    await expect(
      page.getByRole("heading", { name: fx.customerPageName }),
    ).toBeVisible();
    await expect(page.getByText(fx.customerPageQuery)).toBeVisible();

    await openPalette(page, fx.shipmentUiTracking);
    await dialog
      .getByRole("option")
      .filter({ hasText: fx.shipmentUiTracking })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/orders/${fx.shipmentOrderId}#shipments$`),
    );
    const shipmentAnchor = page.locator("#shipments");
    await expect(shipmentAnchor).toBeVisible();
    await expect(shipmentAnchor).toBeInViewport();
    await expect(shipmentAnchor.getByText(fx.shipmentUiTracking)).toBeVisible();

    await openPalette(page, fx.uiToken);
    await page.getByRole("button", { name: "查看全部结果" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/search\\?q=${fx.uiToken}$`),
    );
    await expect(page.getByRole("heading", { name: "商品" })).toBeVisible();
    await expect(page.getByText(fx.uiToken, { exact: true }).first()).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: resolve(
        SCREENSHOTS,
        "phase-b-global-search-results-1440.png",
      ),
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({
      path: resolve(
        SCREENSHOTS,
        "phase-b-global-search-results-1920.png",
      ),
    });
  });

  test("Warehouse sees only Order and Shipment groups in UI and direct payload", async ({ page }) => {
    const fx = fixtures!;
    await openSession(page, ACCOUNTS.warehouse);
    await openPalette(page, fx.uiToken);
    const dialog = page.getByRole("dialog", { name: "全局搜索" });
    await expect(dialog.getByRole("heading", { name: "订单" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "物流" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "商品" })).toHaveCount(0);
    await expect(dialog.getByRole("heading", { name: "客户" })).toHaveCount(0);

    const response = await search(fx.uiToken, 20, ACCOUNTS.warehouse);
    expect(Object.keys(response.groups).sort()).toEqual(["orders", "shipments"]);
  });

  test("Optimizer receives an empty search aggregate and can build only public campaign links", async ({ page }) => {
    const fx = fixtures!;
    const response = await search(fx.uiToken, 20, ACCOUNTS.optimizer);
    expect(response.groups).toEqual({});

    await openSession(page, ACCOUNTS.optimizer);
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "全局搜索" });
    await expect(dialog).toContainText("当前账户没有可搜索的模块");
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await expect(dialog.getByRole("option")).toHaveCount(0);
    await page.keyboard.press("Escape");

    const session = await login(ACCOUNTS.optimizer);
    const contextResponse = await api.get(`${API}/admin/link-builder/context`, {
      headers: authHeaders(session.accessToken),
    });
    expect(
      contextResponse.ok(),
      `link-builder context: ${contextResponse.status()} ${await contextResponse.text()}`,
    ).toBeTruthy();
    const context = (await contextResponse.json()) as {
      products: {
        id: string;
        name: string;
        slug: string;
        variants: { id: string; name: string }[];
        landingPages: { id: string; slug: string; title: string }[];
      }[];
    };
    expect(Object.keys(context)).toEqual(["products"]);
    for (const product of context.products) {
      expect(Object.keys(product).sort()).toEqual([
        "id",
        "landingPages",
        "name",
        "slug",
        "variants",
      ]);
      for (const variant of product.variants) {
        expect(Object.keys(variant).sort()).toEqual(["id", "name"]);
      }
      for (const landingPage of product.landingPages) {
        expect(Object.keys(landingPage).sort()).toEqual([
          "id",
          "slug",
          "title",
        ]);
      }
    }
    expect(JSON.stringify(context)).not.toMatch(
      /customer|orderNumber|profit|supplierCost|optimizerId|adCode/i,
    );

    for (const deniedPath of [
      "/admin/products?page=1&pageSize=1",
      "/admin/landing-pages?page=1&pageSize=1",
    ]) {
      const denied = await api.get(`${API}${deniedPath}`, {
        headers: authHeaders(session.accessToken),
      });
      expect(denied.status(), deniedPath).toBe(403);
    }

    const product = context.products.find(
      (item) => item.slug === "e2e-color-size",
    );
    expect(product, "active color-size product in public context").toBeTruthy();
    const variant = product!.variants.find(
      (item) => item.name === "Red / Small",
    );
    const landingPage = product!.landingPages.find(
      (item) => item.slug === "e2e-lp-color-size",
    );
    expect(variant, "active Red / Small variant").toBeTruthy();
    expect(landingPage, "live seeded landing page").toBeTruthy();

    await page.evaluate(() => {
      const scope = window as typeof window & { __copiedLink?: string };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            scope.__copiedLink = value;
          },
        },
      });
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole("link", { name: "投放链接" }).click();
    await expect(page).toHaveURL(/\/admin\/link-builder$/);
    await expect(
      page.getByRole("heading", { name: "投放链接生成器" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "投放链接" })).toBeVisible();
    await expect(page.getByRole("link", { name: "订单" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "商品" })).toHaveCount(0);

    await page.locator("#link-builder-product").selectOption(product!.id);
    await page.locator("#link-builder-variant").selectOption(variant!.id);
    await page
      .locator("#link-builder-landing-page")
      .selectOption(landingPage!.id);
    await page.getByLabel(/优化师 \/ AID/).fill("optimizer e2e & PH");
    await page.getByLabel("来源（UTM Source）").fill("Meta Ads / PH");
    await page.getByLabel("Campaign ID").fill("campaign/2026?phase=1");
    await page.getByLabel("Ad Set ID").fill("adset-7");
    await page.getByLabel("Ad ID").fill("ad-9");
    await page.getByLabel("UTM Medium").fill("paid-social");
    await page.getByLabel("UTM Campaign").fill("Condo + Chair");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: resolve(
        SCREENSHOTS,
        "phase4-optimizer-link-builder-desktop.png",
      ),
      fullPage: true,
    });

    await page.getByRole("button", { name: "生成链接" }).click();
    const generated = page.getByTestId("generated-campaign-url");
    await expect(generated).toBeVisible();
    const generatedUrl = new URL((await generated.textContent()) ?? "");
    expect(generatedUrl.origin).toBe("https://luwag.ph");
    expect(generatedUrl.pathname).toBe("/lp/e2e-lp-color-size");
    expect(generatedUrl.searchParams.get("variant")).toBe(variant!.id);
    expect(generatedUrl.searchParams.get("aid")).toBe("optimizer e2e & PH");
    expect(generatedUrl.searchParams.get("campaign_id")).toBe(
      "campaign/2026?phase=1",
    );
    expect(generatedUrl.searchParams.get("adset_id")).toBe("adset-7");
    expect(generatedUrl.searchParams.get("ad_id")).toBe("ad-9");
    expect(generatedUrl.searchParams.get("utm_source")).toBe("Meta Ads / PH");
    expect(generatedUrl.searchParams.get("utm_medium")).toBe("paid-social");
    expect(generatedUrl.searchParams.get("utm_campaign")).toBe(
      "Condo + Chair",
    );
    expect(generatedUrl.searchParams.has("landingPageId")).toBe(false);
    expect(generatedUrl.searchParams.has("landing_page_id")).toBe(false);
    for (const key of [
      "variant",
      "aid",
      "campaign_id",
      "adset_id",
      "ad_id",
      "utm_source",
      "utm_medium",
      "utm_campaign",
    ]) {
      expect(generatedUrl.searchParams.getAll(key), key).toHaveLength(1);
    }

    const productUrl = `https://luwag.ph/products/${product!.slug}`;
    const variantUrl = `${productUrl}?variant=${variant!.id}`;
    for (const copy of [
      { name: "复制商品链接", expected: productUrl },
      { name: "复制款式链接", expected: variantUrl },
      { name: "复制投放链接", expected: generatedUrl.toString() },
    ]) {
      await page.getByRole("button", { name: copy.name }).click();
      await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as typeof window & { __copiedLink?: string })
                .__copiedLink,
          ),
        )
        .toBe(copy.expected);
    }

    const generatedSection = page.locator(
      'section[aria-labelledby="link-builder-generated-heading"]',
    );
    await generatedSection.screenshot({
      path: resolve(SCREENSHOTS, "phase4-generated-url.png"),
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(
      page.getByRole("heading", { name: "投放链接生成器" }),
    ).toBeInViewport();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: resolve(
        SCREENSHOTS,
        "phase4-optimizer-link-builder-mobile-375.png",
      ),
      fullPage: true,
    });
  });
});
