import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PermissionCode, RoleCode } from '../src/generated/prisma/client.js';
import { reconcileProductFaqPermission } from './reconcile-product-faq-permission.js';
import { RBAC_GRANTS, RBAC_PERMISSIONS } from './rbac.js';

interface PermissionRow {
  id: string;
  code: PermissionCode;
  description: string | null;
}

interface RbacState {
  permissions: PermissionRow[];
  grants: Set<string>;
}

const roles = Object.values(RoleCode).map((code, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  code,
}));
const faqRoles = new Set<RoleCode>([RoleCode.SUPER_ADMIN, RoleCode.ADMIN]);

function grantKey(roleId: string, permissionId: string): string {
  return `${roleId}:${permissionId}`;
}

function roleId(code: RoleCode): string {
  return roles.find((role) => role.code === code)!.id;
}

function fakeFaqPrisma(state: RbacState, availableRoles = roles) {
  const transaction = {
    permission: {
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: Omit<PermissionRow, 'id'>;
          update: Pick<PermissionRow, 'description'>;
        }) => {
          const existing = state.permissions.find(
            (permission) => permission.code === create.code,
          );
          if (existing) {
            existing.description = update.description;
            return { id: existing.id };
          }
          const created: PermissionRow = {
            id: '10000000-0000-4000-8000-000000000003',
            ...create,
          };
          state.permissions.push(created);
          return { id: created.id };
        },
      ),
    },
    role: {
      findMany: vi.fn(async () =>
        availableRoles.filter((role) => faqRoles.has(role.code)),
      ),
    },
    rolePermission: {
      createMany: vi.fn(
        async ({
          data,
        }: {
          data: { roleId: string; permissionId: string }[];
        }) => {
          const before = state.grants.size;
          for (const grant of data) {
            state.grants.add(grantKey(grant.roleId, grant.permissionId));
          }
          return { count: state.grants.size - before };
        },
      ),
    },
  };

  return {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
}

describe('RBAC reference data', () => {
  it('keeps permission declarations and every role grant duplicate-free', () => {
    const permissionCodes = RBAC_PERMISSIONS.map(
      (permission) => permission.code,
    );
    expect(new Set(permissionCodes).size).toBe(permissionCodes.length);

    for (const grants of Object.values(RBAC_GRANTS)) {
      expect(new Set(grants).size).toBe(grants.length);
    }
  });
});

describe('RBAC order workbench permissions', () => {
  const orderCodes = [
    PermissionCode.ORDER_ASSIGN,
    PermissionCode.ORDER_VERIFY,
    PermissionCode.ORDER_NOTE_WRITE,
    PermissionCode.ORDER_RISK_WRITE,
    PermissionCode.ORDER_MERGE,
    PermissionCode.ORDER_HANDOVER,
  ];

  it('declares every order permission exactly once', () => {
    for (const code of orderCodes) {
      expect(RBAC_PERMISSIONS.filter((p) => p.code === code)).toHaveLength(1);
    }
  });

  it('lets the customer-service roles run the checklist', () => {
    for (const role of [RoleCode.ADMIN, RoleCode.CONFIRMOR, RoleCode.SUPER_ADMIN]) {
      expect(RBAC_GRANTS[role]).toContain(PermissionCode.ORDER_ASSIGN);
      expect(RBAC_GRANTS[role]).toContain(PermissionCode.ORDER_VERIFY);
    }
  });

  it('keeps merging an order away from the customer-service role', () => {
    expect(RBAC_GRANTS[RoleCode.ADMIN]).toContain(PermissionCode.ORDER_MERGE);
    expect(RBAC_GRANTS[RoleCode.SUPER_ADMIN]).toContain(PermissionCode.ORDER_MERGE);
    for (const role of [RoleCode.CONFIRMOR, RoleCode.WAREHOUSE, RoleCode.FINANCE, RoleCode.OPTIMIZER]) {
      expect(RBAC_GRANTS[role]).not.toContain(PermissionCode.ORDER_MERGE);
    }
  });

  it('gives the warehouse the handover and the notes, but no risk or verification', () => {
    expect(RBAC_GRANTS[RoleCode.WAREHOUSE]).toContain(PermissionCode.ORDER_HANDOVER);
    expect(RBAC_GRANTS[RoleCode.WAREHOUSE]).toContain(PermissionCode.ORDER_NOTE_WRITE);
    expect(RBAC_GRANTS[RoleCode.WAREHOUSE]).not.toContain(PermissionCode.ORDER_RISK_WRITE);
    expect(RBAC_GRANTS[RoleCode.WAREHOUSE]).not.toContain(PermissionCode.ORDER_VERIFY);
  });

  it('never grants an order write to the read-only roles', () => {
    for (const role of [RoleCode.FINANCE, RoleCode.OPTIMIZER]) {
      for (const code of orderCodes) {
        expect(RBAC_GRANTS[role]).not.toContain(code);
      }
    }
  });
});

describe('RBAC newsletter permissions', () => {
  it('declares newsletter read/write and grants both to ADMIN and SUPER_ADMIN', () => {
    expect(RBAC_PERMISSIONS).toEqual(
      expect.arrayContaining([
        {
          code: PermissionCode.NEWSLETTER_READ,
          description: 'View newsletter subscribers.',
        },
        {
          code: PermissionCode.NEWSLETTER_WRITE,
          description: 'Manage newsletter subscribers.',
        },
      ]),
    );

    for (const role of [RoleCode.ADMIN, RoleCode.SUPER_ADMIN]) {
      expect(RBAC_GRANTS[role]).toContain(PermissionCode.NEWSLETTER_READ);
      expect(RBAC_GRANTS[role]).toContain(PermissionCode.NEWSLETTER_WRITE);
    }
  });

  it('does not grant newsletter access to operational roles', () => {
    for (const role of [
      RoleCode.OPTIMIZER,
      RoleCode.CONFIRMOR,
      RoleCode.WAREHOUSE,
      RoleCode.FINANCE,
    ]) {
      expect(RBAC_GRANTS[role]).not.toContain(PermissionCode.NEWSLETTER_READ);
      expect(RBAC_GRANTS[role]).not.toContain(PermissionCode.NEWSLETTER_WRITE);
    }
  });
});

describe('RBAC campaign link builder permission', () => {
  it('declares CAMPAIGN_LINK_BUILD as seeded reference data', () => {
    expect(RBAC_PERMISSIONS).toContainEqual({
      code: PermissionCode.CAMPAIGN_LINK_BUILD,
      description: 'Build public product, variant and attribution links.',
    });
  });

  it('grants link building only to the intended roles', () => {
    expect(RBAC_GRANTS[RoleCode.SUPER_ADMIN]).toContain(
      PermissionCode.CAMPAIGN_LINK_BUILD,
    );
    expect(RBAC_GRANTS[RoleCode.ADMIN]).toContain(
      PermissionCode.CAMPAIGN_LINK_BUILD,
    );
    expect(RBAC_GRANTS[RoleCode.OPTIMIZER]).toEqual([
      PermissionCode.ORDER_VIEW_OWN,
      PermissionCode.CAMPAIGN_LINK_BUILD,
      PermissionCode.MARKETING_VIEW_OWN,
      PermissionCode.MARKETING_MANAGE_OWN,
    ]);
    expect(RBAC_GRANTS[RoleCode.CONFIRMOR]).not.toContain(
      PermissionCode.CAMPAIGN_LINK_BUILD,
    );
    expect(RBAC_GRANTS[RoleCode.WAREHOUSE]).not.toContain(
      PermissionCode.CAMPAIGN_LINK_BUILD,
    );
    expect(RBAC_GRANTS[RoleCode.FINANCE]).not.toContain(
      PermissionCode.CAMPAIGN_LINK_BUILD,
    );
  });
});

describe('RBAC product FAQ shared-library permission', () => {
  it('declares PRODUCT_FAQ_SHARED_MANAGE exactly once', () => {
    expect(
      RBAC_PERMISSIONS.filter(
        (permission) =>
          permission.code === PermissionCode.PRODUCT_FAQ_SHARED_MANAGE,
      ),
    ).toEqual([
      {
        code: PermissionCode.PRODUCT_FAQ_SHARED_MANAGE,
        description:
          'Edit the site-wide shared FAQ library every product may use.',
      },
    ]);
  });

  it('grants shared FAQ management only to SUPER_ADMIN and ADMIN', () => {
    for (const role of Object.values(RoleCode)) {
      const expectation = expect(RBAC_GRANTS[role]);
      if (faqRoles.has(role)) {
        expectation.toContain(PermissionCode.PRODUCT_FAQ_SHARED_MANAGE);
      } else {
        expectation.not.toContain(PermissionCode.PRODUCT_FAQ_SHARED_MANAGE);
      }
    }
  });
});

describe('production product FAQ RBAC reconciliation', () => {
  it('creates the permission and grants it only to SUPER_ADMIN and ADMIN', async () => {
    const state: RbacState = { permissions: [], grants: new Set() };

    const result = await reconcileProductFaqPermission(
      fakeFaqPrisma(state) as never,
    );

    expect(state.permissions).toEqual([
      expect.objectContaining({
        code: PermissionCode.PRODUCT_FAQ_SHARED_MANAGE,
        description:
          'Edit the site-wide shared FAQ library every product may use.',
      }),
    ]);
    for (const role of Object.values(RoleCode)) {
      const key = grantKey(roleId(role), result.permissionId);
      if (faqRoles.has(role)) {
        expect(state.grants).toContain(key);
      } else {
        expect(state.grants).not.toContain(key);
      }
    }
    expect(new Set(result.grantedRoleCodes)).toEqual(faqRoles);
    expect(result.grantsCreated).toBe(2);
  });

  it('updates the description, preserves unrelated grants, and is idempotent', async () => {
    const permission: PermissionRow = {
      id: '10000000-0000-4000-8000-000000000003',
      code: PermissionCode.PRODUCT_FAQ_SHARED_MANAGE,
      description: 'Old description',
    };
    const unrelatedGrant = 'role-existing:permission-existing';
    const state: RbacState = {
      permissions: [permission],
      grants: new Set([unrelatedGrant]),
    };
    const prisma = fakeFaqPrisma(state);

    await reconcileProductFaqPermission(prisma as never);
    const first = {
      permissions: structuredClone(state.permissions),
      grants: [...state.grants],
    };
    const second = await reconcileProductFaqPermission(prisma as never);

    expect({
      permissions: state.permissions,
      grants: [...state.grants],
    }).toEqual(first);
    expect(state.permissions[0]?.description).toBe(
      'Edit the site-wide shared FAQ library every product may use.',
    );
    expect(state.grants).toContain(unrelatedGrant);
    expect(second.grantsCreated).toBe(0);
  });

  it('keeps a blank database bootstrappable without creating roles', async () => {
    const state: RbacState = { permissions: [], grants: new Set() };

    const result = await reconcileProductFaqPermission(
      fakeFaqPrisma(state, []) as never,
    );

    expect(state.permissions).toHaveLength(1);
    expect(state.grants).toEqual(new Set());
    expect(result.missingRoleCodes).toEqual([
      RoleCode.SUPER_ADMIN,
      RoleCode.ADMIN,
    ]);
  });

  it('runs after migrations and before API startup', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    const entrypoint = await readFile(
      new URL('../docker-entrypoint.sh', import.meta.url),
      'utf8',
    );
    const runner = await readFile(
      new URL('./reconcile-product-faq-permission-runner.ts', import.meta.url),
      'utf8',
    );

    expect(packageJson.scripts['rbac:reconcile-product-faq']).toBe(
      'tsx prisma/reconcile-product-faq-permission-runner.ts',
    );
    expect(runner).toMatch(
      /new PrismaPg\([\s\S]*schema: process\.env\.DATABASE_SCHEMA as string/,
    );
    const migrateAt = entrypoint.indexOf('prisma migrate deploy');
    const reconcileAt = entrypoint.indexOf('rbac:reconcile-product-faq');
    const startAt = entrypoint.indexOf('exec node dist/main');
    expect(migrateAt).toBeGreaterThanOrEqual(0);
    expect(reconcileAt).toBeGreaterThan(migrateAt);
    expect(startAt).toBeGreaterThan(reconcileAt);
  });
});

describe('RBAC marketing permissions', () => {
  it('declares the four owner-scoped marketing permissions', () => {
    const codes = RBAC_PERMISSIONS.map((permission) => permission.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        PermissionCode.MARKETING_VIEW_OWN,
        PermissionCode.MARKETING_MANAGE_OWN,
        PermissionCode.MARKETING_VIEW_ALL,
        PermissionCode.MARKETING_MANAGE_ALL,
      ]),
    );
  });

  it('keeps every permission described', () => {
    for (const permission of RBAC_PERMISSIONS) {
      expect(permission.description.length).toBeGreaterThan(0);
    }
  });

  it('gives an optimizer own scope but never all scope', () => {
    const optimizer = RBAC_GRANTS[RoleCode.OPTIMIZER];
    expect(optimizer).toContain(PermissionCode.MARKETING_VIEW_OWN);
    expect(optimizer).toContain(PermissionCode.MARKETING_MANAGE_OWN);
    expect(optimizer).not.toContain(PermissionCode.MARKETING_VIEW_ALL);
    expect(optimizer).not.toContain(PermissionCode.MARKETING_MANAGE_ALL);
  });

  it('gives finance read-only all scope, without manage', () => {
    const finance = RBAC_GRANTS[RoleCode.FINANCE];
    expect(finance).toContain(PermissionCode.MARKETING_VIEW_ALL);
    expect(finance).not.toContain(PermissionCode.MARKETING_MANAGE_ALL);
  });

  it('does not leak marketing scope to confirmor or warehouse', () => {
    for (const role of [RoleCode.CONFIRMOR, RoleCode.WAREHOUSE]) {
      const grants = RBAC_GRANTS[role];
      expect(grants).not.toContain(PermissionCode.MARKETING_VIEW_OWN);
      expect(grants).not.toContain(PermissionCode.MARKETING_VIEW_ALL);
    }
  });
});
