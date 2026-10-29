// One-off preview data for the disposable marketing preview database.
// Mirrors the minimal model the marketing integration specs use: one owner
// (the seeded SUPER_ADMIN), three active products with images, campaign
// links per source type, sessions, funnel events, ad costs and a few orders.
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient ({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
}) as unknown as PrismaClient;

const now = new Date();
const day = (offset: number) => new Date(now.getTime() - offset * 864e5);

const products = [
  { name: 'Height-Adjustable Kids Study Chair', code: 'P-000013', slug: 'kids-chair', color: '#c65a3f' },
  { name: 'Nordic Pine Side Table', code: 'P-000021', slug: 'side-table', color: '#3b6e57' },
  { name: 'Oak Reading Lamp', code: 'P-000029', slug: 'reading-lamp', color: '#6b4f8a' },
];
const thumb = (label: string, color: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${color}"/><text x="60" y="66" font-size="14" fill="#fff" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`)}`;

async function main() {
  const admin = (await prisma.user.findFirst({ where: { email: 'preview-admin@smallhouse.test' } }))!;
  const category = (await prisma.category.create({ data: { name: 'Preview catalog', slug: `preview-${randomUUID().slice(0, 8)}` } }));
  const productIds: string[] = [];
  for (const spec of products) {
    const product = (await prisma.product.create({
      data: {
        categoryId: category.id, name: spec.name, productCode: spec.code, slug: spec.slug,
        status: 'ACTIVE', solutions: [],
        images: { create: { url: thumb(spec.name.split(' ')[1] ?? spec.name, spec.color), type: 'IMAGE', sortOrder: 0, altText: spec.name } },
      },
    }));
    productIds.push(product.id);
  }
  const linkSpecs = [
    { product: 0, name: '1029-CH002', sourceType: 'META_AD' as const, adId: '1202109772041' },
    { product: 0, name: '1028-CH003', sourceType: 'FB_POST' as const, adId: null },
    { product: 0, name: '1027-CH001', sourceType: 'FB_POST' as const, adId: null },
    { product: 1, name: '1029-TB002', sourceType: 'META_AD' as const, adId: '1202109772077' },
    { product: 2, name: '1029-LP001', sourceType: 'META_AD' as const, adId: '1202109772091' },
  ];
  const links: { id: string; label: string; code: string; owner: string }[] = [];
  for (const spec of linkSpecs) {
    const link = await prisma.campaignLink.create({
      data: { productId: productIds[spec.product], ownerUserId: admin.id, aidSnapshot: 'OP-1000', name: spec.name, code: randomUUID().replaceAll('-', '').slice(0, 16), sourceType: spec.sourceType, adId: spec.adId, campaignId: spec.sourceType === 'META_AD' ? 'campaign-8817' : null, createdAt: day(9), landingPageId: null },
    });
    links.push({ id: link.id, label: spec.name, code: link.code, owner: admin.id });
  }

  // Cross-link shared session: the same tab hits every link on the same day.
  for (const position of [0, 1, 2, 3, 4]) {
    await prisma.campaignLinkVisit.create({ data: { linkId: links[position].id, visitKey: 'shared-tab-1', visitDay: new Date(new Date(day(1)).toISOString().slice(0, 10)), createdAt: day(1) } });
  }
  for (const [position, count] of [[0, 9], [1, 7], [2, 4], [3, 3], [4, 5]] as const) {
    for (let visit = 0; visit < count; visit += 1) {
      for (let offset = 1; offset <= 6; offset += 1) {
        await prisma.campaignLinkVisit.create({ data: { linkId: links[position].id, visitKey: `uni-${position}-${visit}`, visitDay: new Date(new Date(day(offset)).toISOString().slice(0, 10)), createdAt: day(offset) } });
      }
    }
  }

  // Funnel events: add to cart / checkout started / page views behind the labels.
  const funnel: Array<[number, 'ADD_TO_CART' | 'BEGIN_CHECKOUT' | 'PAGE_VIEW', number, number]> = [
    [0, 'ADD_TO_CART', 12, 0], [0, 'BEGIN_CHECKOUT', 5, 0], [0, 'PAGE_VIEW', 30, 0],
    [1, 'ADD_TO_CART', 4, 0], [1, 'BEGIN_CHECKOUT', 1, 0], [1, 'PAGE_VIEW', 22, 0],
    [2, 'ADD_TO_CART', 1, 3], [2, 'PAGE_VIEW', 11, 3],
    [3, 'ADD_TO_CART', 2, 0], [3, 'PAGE_VIEW', 9, 0],
    [4, 'ADD_TO_CART', 5, 0], [4, 'BEGIN_CHECKOUT', 2, 0], [4, 'PAGE_VIEW', 16, 0],
  ];
  for (const [position, name, total, offsetBase] of funnel) {
    for (let count = 0; count < total; count += 1) {
      const dayOffset = 1 + ((offsetBase + count) % 6);
      await prisma.analyticsEvent.create({ data: { eventName: name, sessionId: `fun-${position}-${count}`, pageUrl: 'https://luwag.shop/products/x', pagePath: '/products/x', deviceType: 'mobile', eventDay: new Date(new Date(day(dayOffset)).toISOString().slice(0, 10)), campaignLinkId: links[position].id, productId: productIds[linkSpecs[position].product] } });
    }
  }

  // Ad costs for every day of the run so CPA/ROAS are complete.
  for (const link of links) {
    for (let offset = 1; offset <= 6; offset += 1) {
      const costDate = new Date(new Date(day(offset)).toISOString().slice(0, 10));
      const amountUsd = linkSpecs[links.indexOf(link)].sourceType === 'META_AD' ? 40 : 12;
      await prisma.adCostEntry.create({ data: { linkId: link.id, ownerUserId: admin.id, costDate, amountUsd: String(amountUsd), phpPerUsd: '57.3', amountPhp: String(Math.round(amountUsd * 57.3 * 100) / 100), entrySource: 'MANUAL', createdById: admin.id, updatedById: admin.id } });
    }
  }

  // A handful of orders per link through the same shapes the integration specs create.
  const customer = await prisma.customer.create({ data: { name: 'Preview customer', normalizedPhone: `preview-${randomUUID().slice(0, 8)}` } });
  const warehouse = (await prisma.warehouse.findFirst())!;
  const statuses = ['SHIPPING', 'CONFIRMED', 'SHIPPING'] as const;
  for (const [position, count] of [[0, 3], [1, 2], [4, 2]] as const) {
    for (let order = 0; order < count; order += 1) {
      const link = links[position];
      const value = String(3499 * (1 + order));
      const row = await prisma.order.create({ data: {
        orderNumber: `PH${100000 + order}${position}`, customerId: customer.id, subtotal: value, discountTotal: 0, shippingTotal: 0,
        grandTotal: value, orderStatus: statuses[order % statuses.length] as never, paymentStatus: 'COD_PENDING' as never, createdAt: day(2 + order),
        customerClassification: 'NEW' as never,
        attribution: { create: { optimizerId: admin.id, aidSnapshot: 'OP-1000', ownerNameSnapshot: 'Dev Admin', productId: productIds[linkSpecs[position].product], productNameSnapshot: products[linkSpecs[position].product].name, sourceType: linkSpecs[position].sourceType, linkId: link.id, touchedAt: day(2 + order), legacy: false } },
      } });
      if (order === 1) await prisma.shipment.create({ data: { orderId: row.id, warehouseId: warehouse.id, carrier: 'J&T', status: 'SIGNED', shippedAt: day(1), signedAt: day(1) } });
    }
  }
  console.log('preview data done');
  await prisma.$disconnect();
}

main();
