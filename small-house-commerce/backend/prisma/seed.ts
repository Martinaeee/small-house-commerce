// Seeds the reference data the RBAC tables need: the six roles, the twelve
// permission codes, and the role -> permission grants.
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
  PermissionCode,
  RoleCode,
  type PermissionCode as PermissionCodeType,
  type RoleCode as RoleCodeType,
} from '../src/generated/prisma/client.js';

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

const PERMISSIONS: { code: PermissionCodeType; description: string }[] = [
  { code: PermissionCode.ORDER_VIEW_ALL, description: 'View every order regardless of optimizer.' },
  { code: PermissionCode.ORDER_VIEW_OWN, description: 'View only orders attributed to the current optimizer.' },
  { code: PermissionCode.ORDER_CONFIRM, description: 'Confirm a COD order.' },
  { code: PermissionCode.ORDER_CANCEL, description: 'Cancel an order, including risky ones.' },
  { code: PermissionCode.ORDER_CHANGE_AID, description: 'Change the AID attribution of an order.' },
  { code: PermissionCode.CUSTOMER_RISK_VIEW, description: 'View customer risk events and history.' },
  { code: PermissionCode.CUSTOMER_RISK_EDIT, description: 'Create or edit customer risk events.' },
  { code: PermissionCode.INVENTORY_VIEW, description: 'View stock levels.' },
  { code: PermissionCode.INVENTORY_ADJUST, description: 'Manually adjust stock.' },
  { code: PermissionCode.SHIPMENT_CREATE, description: 'Create shipments and update shipment status.' },
  { code: PermissionCode.REPORT_PROFIT_VIEW, description: 'View company profit and profit reports.' },
  { code: PermissionCode.SYSTEM_SETTINGS_EDIT, description: 'Edit system and security configuration.' },
];

// --- grants (ADMIN_SPEC.md §4) ----------------------------------------------
//
// SUPER_ADMIN  Full access (all orders, products, inventory, reports, users, settings)
// ADMIN        Everything operational; explicitly denied system security config
// OPTIMIZER    Own orders only; explicitly denied company profit
// CONFIRMOR    Order confirmation path; denied inventory writes and profit
// WAREHOUSE    Fulfillment; denied attribution changes and profit
// FINANCE      Read-only analytics; no operational writes

const ALL_PERMISSIONS: PermissionCodeType[] = PERMISSIONS.map((p) => p.code);

const GRANTS: Record<RoleCodeType, PermissionCodeType[]> = {
  [RoleCode.SUPER_ADMIN]: ALL_PERMISSIONS,

  [RoleCode.ADMIN]: [
    PermissionCode.ORDER_VIEW_ALL,
    PermissionCode.ORDER_CONFIRM,
    PermissionCode.ORDER_CANCEL,
    PermissionCode.ORDER_CHANGE_AID,
    PermissionCode.CUSTOMER_RISK_VIEW,
    PermissionCode.CUSTOMER_RISK_EDIT,
    PermissionCode.INVENTORY_VIEW,
    PermissionCode.INVENTORY_ADJUST,
    PermissionCode.SHIPMENT_CREATE,
    PermissionCode.REPORT_PROFIT_VIEW,
    // deliberately not SYSTEM_SETTINGS_EDIT
  ],

  [RoleCode.OPTIMIZER]: [
    PermissionCode.ORDER_VIEW_OWN,
    // deliberately not REPORT_PROFIT_VIEW, not ORDER_VIEW_ALL
  ],

  [RoleCode.CONFIRMOR]: [
    PermissionCode.ORDER_VIEW_ALL,
    PermissionCode.ORDER_CONFIRM,
    PermissionCode.ORDER_CANCEL,
    PermissionCode.CUSTOMER_RISK_VIEW,
    PermissionCode.CUSTOMER_RISK_EDIT,
    // deliberately not INVENTORY_ADJUST, not REPORT_PROFIT_VIEW
  ],

  [RoleCode.WAREHOUSE]: [
    PermissionCode.ORDER_VIEW_ALL,
    PermissionCode.INVENTORY_VIEW,
    PermissionCode.SHIPMENT_CREATE,
    // deliberately not ORDER_CHANGE_AID, not REPORT_PROFIT_VIEW, not INVENTORY_ADJUST
  ],

  [RoleCode.FINANCE]: [
    PermissionCode.ORDER_VIEW_ALL,
    PermissionCode.REPORT_PROFIT_VIEW,
    // deliberately no write permissions
  ],
};

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

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
