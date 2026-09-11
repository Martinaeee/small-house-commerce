// Seeds the two-level storefront category tree used by the mega menu
// (docs/superpowers/specs/2026-09-11-navigation-mega-menu-design.md §1).
//
// Idempotent: safe to re-run. Categories are upserted by slug; imageUrl is
// never overwritten on update so images added later (or via admin) survive.
// Demo products still attached to the pre-seed stray "chairs" root are
// remapped by keyword; products already inside the new tree are left alone,
// so admin recategorization survives a second run.

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const TREE: { name: string; slug: string; leaves: Array<[string, string]> }[] = [
  {
    name: 'Storage & Organization',
    slug: 'storage-organization',
    leaves: [
      ['Shelving & Racks', 'shelving-racks'],
      ['Cabinets & Drawers', 'cabinets-drawers'],
      ['Wardrobes', 'wardrobes'],
      ['Shoe Racks', 'shoe-racks'],
      ['Kitchen & Bathroom Storage', 'kitchen-bathroom-storage'],
    ],
  },
  {
    name: 'Tables & Desks',
    slug: 'tables-desks',
    leaves: [
      ['Dining Tables', 'dining-tables'],
      ['Desks', 'desks'],
      ['Coffee & Side Tables', 'coffee-side-tables'],
      ['Folding Tables', 'folding-tables'],
    ],
  },
  {
    name: 'Chairs & Stools',
    slug: 'chairs-stools',
    leaves: [
      ['Dining Chairs', 'dining-chairs'],
      ['Office Chairs', 'office-chairs'],
      ['Stools & Bar Stools', 'stools-bar-stools'],
      ['Benches', 'benches'],
    ],
  },
  {
    name: 'Bedroom Essentials',
    slug: 'bedroom-essentials',
    leaves: [
      ['Bed Frames', 'bed-frames'],
      ['Mattresses', 'mattresses'],
      ['Bedside Tables', 'bedside-tables'],
      ['Bedroom Storage', 'bedroom-storage'],
    ],
  },
];

/** Keyword fallback for demo products without a natural home in the tree. */
const FALLBACK_LEAF = 'shelving-racks';

function leafSlugFor(name: string, slug: string): string {
  const text = `${name} ${slug}`.toLowerCase();
  if (/(stool|bar.?chair)/.test(text)) return 'stools-bar-stools';
  if (/bench/.test(text)) return 'benches';
  if (/office.*chair|desk.*chair/.test(text)) return 'office-chairs';
  if (/chair/.test(text)) return 'dining-chairs';
  if (/(mattress|bed frame|bedframe)/.test(text)) return /mattress/.test(text) ? 'mattresses' : 'bed-frames';
  if (/bedside|nightstand/.test(text)) return 'bedside-tables';
  if (/desk/.test(text)) return 'desks';
  if (/folding.*table/.test(text)) return 'folding-tables';
  if (/dining.*table/.test(text)) return 'dining-tables';
  if (/(coffee|side).*table/.test(text)) return 'coffee-side-tables';
  if (/table/.test(text)) return 'coffee-side-tables';
  if (/wardrobe/.test(text)) return 'wardrobes';
  if (/shoe/.test(text)) return 'shoe-racks';
  if (/(kitchen|bathroom)/.test(text)) return 'kitchen-bathroom-storage';
  if (/(cabinet|drawer|chest)/.test(text)) return 'cabinets-drawers';
  if (/(shelf|shelving|rack|storage)/.test(text)) return 'shelving-racks';
  return FALLBACK_LEAF;
}

async function main() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL as string,
  });
  const prisma = new PrismaClient({ adapter });

  const leafSlugToId = new Map<string, string>();

  await prisma.$transaction(async (tx) => {
    let sortOrder = 0;
    for (const root of TREE) {
      const rootRow = await tx.category.upsert({
        where: { slug: root.slug },
        create: { name: root.name, slug: root.slug, sortOrder: sortOrder++, status: 'ACTIVE' },
        update: { name: root.name, sortOrder: sortOrder++, status: 'ACTIVE' },
      });

      for (const [name, slug] of root.leaves) {
        const leaf = await tx.category.upsert({
          where: { slug },
          create: { name, slug, parentId: rootRow.id, sortOrder: sortOrder++, status: 'ACTIVE' },
          update: { name, parentId: rootRow.id, sortOrder: sortOrder++, status: 'ACTIVE' },
        });
        leafSlugToId.set(slug, leaf.id);
      }
    }

    // Remap demo products still on the pre-seed stray root ("chairs").
    // Products already on a new-tree category are untouched.
    const newIds = new Set(leafSlugToId.values());
    const rootIds = new Set(
      (await tx.category.findMany({ where: { slug: { in: TREE.map((r) => r.slug) } }, select: { id: true } })).map(
        (c) => c.id,
      ),
    );
    const stray = await tx.category.findUnique({
      where: { slug: 'chairs' },
      select: { id: true },
    });

    const candidates = stray
      ? await tx.product.findMany({
          where: { categoryId: stray.id },
          select: { id: true, name: true, slug: true, categoryId: true },
        })
      : [];

    const mapping: Array<[string, string, string]> = [];
    for (const product of candidates) {
      const leafSlug = leafSlugFor(product.name, product.slug);
      const leafId = leafSlugToId.get(leafSlug)!;
      await tx.product.update({ where: { id: product.id }, data: { categoryId: leafId } });
      mapping.push([product.slug, leafSlug, product.categoryId ?? 'null']);
    }

    // The stray category predates the tree and is not part of it; delete once
    // no products reference it (FK is Restrict). Its old products moved above.
    let strayDeleted = false;
    if (stray) {
      const count = await tx.product.count({ where: { categoryId: stray.id } });
      if (count === 0 && !newIds.has(stray.id) && !rootIds.has(stray.id)) {
        await tx.category.delete({ where: { id: stray.id } });
        strayDeleted = true;
      }
    }

    console.log(`categories: ${TREE.length} roots, ${leafSlugToId.size} leaves upserted`);
    for (const [productSlug, leaf, from] of mapping) {
      console.log(`remap: ${productSlug}  ${from} -> ${leaf}`);
    }
    console.log(`stray 'chairs' category: ${strayDeleted ? 'deleted' : 'kept (absent or still referenced)'}`);
  });

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
