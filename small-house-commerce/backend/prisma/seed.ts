// Seeds the reference data the RBAC tables need: the six roles, permission
// codes, and the role -> permission grants.
//
// Sources:
//   docs/DATABASE.md §4 (role list), §6 (permission codes)
//   docs/ADMIN_SPEC.md §4 Role Permission Matrix (capabilities per role)
//
// ADMIN_SPEC describes capabilities in prose, so the grants below are a reading
// of that text rather than a table copied from it. They are seed data, not
// schema: adjust and re-run rather than writing a migration.
//
// Idempotent: safe to run repeatedly. `upsert` on the natural keys.

import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  HomepageSectionType,
  RoleCode,
  type PermissionCode as PermissionCodeType,
  type RoleCode as RoleCodeType,
} from '../src/generated/prisma/client.js';
import { RBAC_GRANTS, RBAC_PERMISSIONS } from './rbac.js';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});
const prisma = new PrismaClient({ adapter });

// --- roles (DATABASE.md §4, ADMIN_SPEC.md §3) -------------------------------

const ROLES: { code: RoleCodeType; name: string; description: string }[] = [
  {
    code: RoleCode.SUPER_ADMIN,
    name: 'Super Admin',
    description: 'Full access, including user management and system settings.',
  },
  {
    code: RoleCode.ADMIN,
    name: 'Admin',
    description:
      'Products, orders, inventory, customers and reports. Cannot change security settings.',
  },
  {
    code: RoleCode.OPTIMIZER,
    name: 'Optimizer',
    description:
      'Marketing performance. Sees only own orders, own AID attribution and own posts.',
  },
  {
    code: RoleCode.CONFIRMOR,
    name: 'Confirmor',
    description:
      'COD confirmation: view pending orders and history, confirm orders, cancel risky orders, add notes.',
  },
  {
    code: RoleCode.WAREHOUSE,
    name: 'Warehouse',
    description:
      'Fulfillment: view shipping orders and inventory, update shipment status.',
  },
  {
    code: RoleCode.FINANCE,
    name: 'Finance',
    description:
      'Financial analysis: revenue, cost, profit, signed revenue. Read-only on operations.',
  },
];

// --- permissions (DATABASE.md §6) -------------------------------------------

const PERMISSIONS = RBAC_PERMISSIONS;

// --- grants (ADMIN_SPEC.md §4) ----------------------------------------------
//
// SUPER_ADMIN  Full access (all orders, products, inventory, reports, users, settings)
// ADMIN        Everything operational; explicitly denied system security config
// OPTIMIZER    Own orders only; explicitly denied company profit
// CONFIRMOR    Order confirmation path; denied inventory writes and profit
// WAREHOUSE    Fulfillment; denied attribution changes and profit
// FINANCE      Read-only analytics; no operational writes

const GRANTS = RBAC_GRANTS;

async function main(): Promise<void> {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }

  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { description: permission.description },
      create: permission,
    });
  }

  let grantCount = 0;

  for (const [roleCode, permissionCodes] of Object.entries(GRANTS) as [
    RoleCodeType,
    PermissionCodeType[],
  ][]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });

    for (const permissionCode of permissionCodes) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { code: permissionCode },
      });

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });

      grantCount += 1;
    }
  }

  console.log(
    `Seeded ${ROLES.length} roles, ${PERMISSIONS.length} permissions, ${grantCount} grants.`,
  );

  await ensureInitialAdmin();
  await ensureDefaultWarehouse();
  await ensureCoreCollections();
  await ensureHomepageSections();
}

/**
 * Creates one bootstrap admin so the API has a login to test with.
 * Email comes from ADMIN_EMAIL (default dev@smallhouse.test). The password
 * comes from ADMIN_PASSWORD; when unset a random one is generated, printed
 * once, and never stored anywhere except the argon2 hash.
 */
async function ensureInitialAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? 'dev@smallhouse.test';

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.log(`Initial admin ${email} already exists, skipping.`);
    return;
  }

  const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
  const passwordHash = await argon2.hash(password);

  const superAdmin = await prisma.role.findUniqueOrThrow({
    where: { code: RoleCode.SUPER_ADMIN },
  });

  await prisma.user.create({
    data: {
      name: 'Dev Admin',
      email,
      passwordHash,
      roles: { create: [{ roleId: superAdmin.id }] },
    },
  });

  if (!process.env.ADMIN_PASSWORD) {
    console.log(`Created initial admin ${email} with generated password: ${password}`);
  } else {
    console.log(`Created initial admin ${email} with ADMIN_PASSWORD from environment.`);
  }
}

/**
 * V1 runs a single Philippines warehouse (DATABASE.md §28 allows more later).
 */
async function ensureDefaultWarehouse(): Promise<void> {
  const existing = await prisma.warehouse.findFirst({ where: { country: 'PH' } });
  if (existing) {
    console.log('Default warehouse already exists, skipping.');
    return;
  }

  await prisma.warehouse.create({
    data: { name: 'Manila Central', country: 'PH', province: 'Metro Manila', city: 'Quezon City' },
  });
  console.log('Created default warehouse: Manila Central.');
}

/**
 * V1 Core Collections (docs/DATABASE.md §102 V1 Core Collections). These back
 * the header navigation and homepage — the frontend MUST NOT hard-code them.
 */
async function ensureCoreCollections(): Promise<void> {
  const core = [
    { name: 'New Arrivals', slug: 'new-arrivals', type: 'NAVIGATION', sortOrder: 1 },
    { name: 'Storage & Organization', slug: 'storage-organization', type: 'NAVIGATION', sortOrder: 2 },
    { name: 'Tables & Desks', slug: 'tables-desks', type: 'NAVIGATION', sortOrder: 3 },
    { name: 'Chairs & Stools', slug: 'chairs-stools', type: 'NAVIGATION', sortOrder: 4 },
    { name: 'Bedroom Essentials', slug: 'bedroom-essentials', type: 'NAVIGATION', sortOrder: 5 },
    { name: 'Small-Space Solutions', slug: 'small-space-solutions', type: 'SCENARIO', sortOrder: 6 },
    { name: 'Best Sellers', slug: 'best-sellers', type: 'SYSTEM', sortOrder: 7 },
  ] as const;

  for (const c of core) {
    await prisma.collection.upsert({
      where: { slug: c.slug },
      update: { name: c.name, type: c.type as never, sortOrder: c.sortOrder },
      create: { ...c, type: c.type as never },
    });
  }
  console.log(`Ensured ${core.length} core collections.`);
}

async function ensureHomepageSections(): Promise<void> {
  // Fixed business key: (type, sortOrder). Re-running the seed refreshes the
  // defaults but never duplicates a section. The two PRODUCT_STORY rows share
  // a type, so sortOrder is part of the key.
  const rootCategories = await prisma.category.findMany({
    where: { parentId: null, status: 'ACTIVE' },
    orderBy: { sortOrder: 'asc' },
    take: 6,
    select: { id: true },
  });

  const sections: Array<{
    type: HomepageSectionType;
    sortOrder: number;
    title: string | null;
    subtitle: string | null;
    payload: Record<string, unknown>;
  }> = [
    {
      type: HomepageSectionType.HERO,
      sortOrder: 0,
      title: 'Small Space. Big Luwag.',
      subtitle:
        'Furniture designed for condos, rentals and everyday small-space living.',
      payload: {
        ctaPrimaryText: 'Shop Small-Space Picks',
        ctaPrimaryLink: '/collections',
        ctaSecondaryText: 'Explore Solutions',
        ctaSecondaryLink: '#solutions',
      },
    },
    { type: HomepageSectionType.USP, sortOrder: 10, title: null, subtitle: null, payload: {} },
    {
      type: HomepageSectionType.CATEGORY_TILES,
      sortOrder: 20,
      title: 'Shop by Category',
      subtitle: null,
      payload: { categoryIds: rootCategories.map((c) => c.id) },
    },
    {
      type: HomepageSectionType.PRODUCT_GRID,
      sortOrder: 30,
      title: 'Small-Space Favorites',
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.PRODUCT_STORY,
      sortOrder: 40,
      title: 'Made For Real Small Spaces',
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.SOLUTIONS,
      sortOrder: 50,
      title: 'Shop by Solution',
      subtitle: 'Whatever your space problem, there is furniture built for it.',
      payload: {
        items: [
          { title: 'Small Bedroom', blurb: 'Compact beds, wardrobes and storage', link: '/collections/bedroom-essentials' },
          { title: 'Home Office', blurb: 'Foldable desks that disappear', link: '/collections/small-space-solutions' },
          { title: 'Rental Friendly', blurb: 'Portable, non-permanent furniture', link: '/collections/small-space-solutions' },
          { title: 'Foldable Furniture', blurb: 'Set up and stow in seconds', link: '/collections/small-space-solutions' },
          { title: 'Narrow Space', blurb: 'Slim profiles for tight corners', link: '/collections/small-space-solutions' },
          { title: 'Storage Solution', blurb: 'Make every corner useful', link: '/collections/storage-organization' },
        ],
      },
    },
    {
      type: HomepageSectionType.PRODUCT_STORY,
      sortOrder: 60,
      title: null,
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.PRODUCT_GRID,
      sortOrder: 70,
      title: 'Small Upgrades',
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.ROOM_INSPIRATION,
      sortOrder: 80,
      title: 'Room Inspiration',
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.UGC,
      sortOrder: 90,
      title: 'Real Homes',
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.BRAND_STORY,
      sortOrder: 100,
      title: null,
      subtitle: null,
      payload: {
        // BRAND_FOUNDATION_V1.md §3.4, verbatim wording (markdown italics removed).
        body: 'LUWAG Living makes furniture for small Filipino homes — the condos, apartments and rentals where every square meter counts. Our name comes from maluwag: spacious, easy-going, and maluwag sa budget. Pieces that fit, prices that don’t hurt, cash on delivery. Because a small space should feel maluwag.',
      },
    },
    {
      type: HomepageSectionType.CONFIDENCE,
      sortOrder: 110,
      title: null,
      subtitle: null,
      payload: {
        // Migrated unchanged from the previous homepage confidence bullets.
        bullets: [
          'Cash on Delivery — pay at your door',
          'Nationwide delivery',
          'Real-time order updates by phone',
        ],
      },
    },
  ];

  for (const section of sections) {
    const existing = await prisma.homepageSection.findFirst({
      where: { type: section.type, sortOrder: section.sortOrder },
      select: { id: true },
    });

    if (existing) {
      await prisma.homepageSection.update({
        where: { id: existing.id },
        data: {
          title: section.title,
          subtitle: section.subtitle,
          payload: section.payload as never,
          enabled: true,
        },
      });
    } else {
      await prisma.homepageSection.create({
        data: {
          type: section.type,
          sortOrder: section.sortOrder,
          title: section.title,
          subtitle: section.subtitle,
          payload: section.payload as never,
          enabled: true,
        },
      });
    }
  }

  console.log(`Ensured ${sections.length} homepage sections.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
