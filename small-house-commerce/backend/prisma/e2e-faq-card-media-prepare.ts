import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma, SkuStatus } from '../src/generated/prisma/client.js';
import { assertFaqE2ETestTarget } from './e2e-faq-test-target.js';

/**
 * E2E-only fixture for the FAQ acceptance specs.
 *
 * FAQ writes go through PATCH /admin/products/:id, whose legacy branch runs
 * the product-card readiness gate for ACTIVE products: every selectable
 * variant (ACTIVE SKU with a price) needs `cardMedia.cover`, and products
 * with two or more selectable variants need a `defaultDisplayVariantId`.
 * seed-e2e only writes product-level media, so a freshly seeded database
 * fails every FAQ PATCH with PRODUCT_CARD_MEDIA_INCOMPLETE. This fixture
 * writes the same cover JSON the admin editor would, for exactly the base
 * scenario products the FAQ specs touch. Idempotent.
 */
const databaseUrl = process.env.DATABASE_URL;
assertFaqE2ETestTarget(databaseUrl, process.env.E2E_PG_PORT ?? '5432');
const connectionString = new URL(databaseUrl!);
connectionString.searchParams.delete('schema');

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString: connectionString.toString() },
    { schema: 'public' },
  ),
});

const SLUGS = [
  'e2e-legacy-style',
  'e2e-color-only',
  'e2e-size-only',
  'e2e-color-size',
  'e2e-exact-override',
] as const;

const SHARED_SET_ID = '00000000-0000-0000-0000-0000000000fa';

/**
 * The seven public entries the seed migration installs. A scenario that
 * replaces the shared library outright restores it in `finally`, but a
 * crash between replace and restore can leave the singleton truncated.
 * Missing migration entries are re-added without replacing entries that are
 * already present. A separate E2E-only legacy entry below is reset without
 * `updatedAt` so the unknown-timestamp row assertion is repeatable even after
 * another scenario has legitimately stamped every submitted item.
 */
const SEEDED_SHARED_ITEMS = [
  {"id":"00000000-0000-4000-8000-000000000701","title":"Delivery & Cash on Delivery","answer":[{"kind":"bullets","items":["Metro Manila: 3–5 days. Free Metro Manila delivery on orders ₱3,000+.","Provinces: 5–7 days through our nationwide delivery partners.","Cash on Delivery is available nationwide — pay only when your order arrives.","Questions about your delivery? Email {{supportEmail}} ({{supportHours}})."]}],"enabled":true,"position":0,"defaultOpen":true},
  {"id":"00000000-0000-4000-8000-000000000702","title":"Returns & Damage Claims","answer":[{"kind":"paragraph","text":"Returns are accepted only for items that arrive damaged or defective. Please contact us at {{supportEmail}} within 48 hours of delivery with photos of the item and its packaging, and we will arrange a replacement or refund. Items cannot be returned for non-quality issues such as change of mind or incorrect size after delivery."}],"enabled":true,"position":1,"defaultOpen":false},
  {"id":"00000000-0000-4000-8000-000000000703","title":"Assembly","answer":[{"kind":"paragraph","text":"Assembly depends on the product. Foldable and ready-to-use items need no setup; other items ship with clear instructions and the hardware needed for assembly. Check the product details above, or contact us before ordering if you are unsure what this item requires."}],"enabled":true,"position":2,"defaultOpen":false},
  {"id":"00000000-0000-4000-8000-000000000704","title":"How does Cash on Delivery work?","answer":[{"kind":"paragraph","text":"Place your order with your name, address and phone number — no payment online. When the rider delivers, inspect the item and pay the rider in cash. Please prepare the exact amount when possible."}],"enabled":true,"position":3,"defaultOpen":false},
  {"id":"00000000-0000-4000-8000-000000000705","title":"Can I change or cancel my order?","answer":[{"kind":"paragraph","text":"Contact us as soon as possible at {{supportEmail}}. Address or item changes are possible while the order is still being processed; once an order has shipped, it can no longer be changed or redirected."}],"enabled":true,"position":4,"defaultOpen":false},
  {"id":"00000000-0000-4000-8000-000000000706","title":"Will it fit my space?","answer":[{"kind":"paragraph","text":"Check the Size guide in the product details above for exact dimensions, and measure your doorway, hallway and intended spot before ordering — especially for sofas, tables and beds. Delivery crews cannot disassemble doorframes, so a few minutes of measuring is the best way to avoid a tight fit."}],"enabled":true,"position":5,"defaultOpen":false},
  {"id":"00000000-0000-4000-8000-000000000707","title":"Do I need to drill or mount anything?","answer":[{"kind":"paragraph","text":"Most LUWAG Living pieces are freestanding or foldable and need no drilling at all, which makes them rental-friendly. If a specific item requires wall fixing, it is noted in the product details."}],"enabled":true,"position":6,"defaultOpen":false}
] as const;

const LEGACY_SHARED_ITEM = {
  id: '70000000-0000-4000-8000-000000000099',
  title: 'E2E legacy shared question without a timestamp?',
  answer: [{ kind: 'paragraph', text: 'Exercises the legacy timestamp label.' }],
  enabled: true,
  position: 498,
  defaultOpen: false,
} as const;

async function main(): Promise<void> {
  for (const slug of SLUGS) {
    const product = await prisma.product.findUnique({
      where: { slug },
      select: {
        id: true,
        defaultDisplayVariantId: true,
        images: {
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { url: true },
        },
        variants: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            sku: { select: { status: true, price: true } },
          },
        },
      },
    });
    if (!product) throw new Error(`seeded product ${slug} is missing`);
    const coverUrl =
      product.images[0]?.url ?? `/uploads/e2e/${slug}-shared-1.svg`;
    const selectable = product.variants.filter(
      (variant) =>
        variant.sku?.status === SkuStatus.ACTIVE && variant.sku.price != null,
    );
    for (const variant of selectable) {
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: {
          cardMedia: {
            cover: { type: 'IMAGE', url: coverUrl, altText: null },
            hover: null,
          },
        },
      });
    }
    if (
      selectable.length >= 2 &&
      !selectable.some((variant) => variant.id === product.defaultDisplayVariantId)
    ) {
      await prisma.product.update({
        where: { id: product.id },
        data: { defaultDisplayVariantId: selectable[0]!.id },
      });
    }
    console.log(
      `faq card media prepared: ${slug} (${selectable.length} selectable variants)`,
    );
  }

  const sharedSet = await prisma.sharedFaqSet.findUnique({
    where: { id: SHARED_SET_ID },
    select: { items: true },
  });
  if (!sharedSet) throw new Error('shared FAQ singleton is missing');
  const items = (
    Array.isArray(sharedSet.items) ? sharedSet.items : []
  ) as Array<Record<string, unknown>>;
  const present = new Set(items.map((item) => item.id));
  const missing = SEEDED_SHARED_ITEMS.filter((item) => !present.has(item.id));
  const withoutLegacyFixture = items.filter(
    (item) => item.id !== LEGACY_SHARED_ITEM.id,
  );
  const preparedItems = [
    ...withoutLegacyFixture,
    ...missing,
    LEGACY_SHARED_ITEM,
  ];
  const changed = JSON.stringify(preparedItems) !== JSON.stringify(items);
  if (changed) {
    await prisma.sharedFaqSet.update({
      where: { id: SHARED_SET_ID },
      data: {
        items: preparedItems as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
  }
  console.log(
    `faq shared library prepared: ${missing.length} seeded items restored; legacy fixture reset=${changed}`,
  );
}

main().then(
  () => prisma.$disconnect(),
  (error: unknown) => {
    console.error(error);
    void prisma.$disconnect().finally(() => {
      process.exitCode = 1;
    });
  },
);
