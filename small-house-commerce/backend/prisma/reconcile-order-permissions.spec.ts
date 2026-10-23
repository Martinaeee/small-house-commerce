import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PermissionCode, RoleCode } from '../src/generated/prisma/client.js';

const allowed: Record<string, string[]> = {
  SUPER_ADMIN: [
    PermissionCode.ORDER_ASSIGN,
    PermissionCode.ORDER_VERIFY,
    PermissionCode.ORDER_NOTE_WRITE,
    PermissionCode.ORDER_RISK_WRITE,
    PermissionCode.ORDER_MERGE,
    PermissionCode.ORDER_HANDOVER,
  ],
  ADMIN: [
    PermissionCode.ORDER_ASSIGN,
    PermissionCode.ORDER_VERIFY,
    PermissionCode.ORDER_NOTE_WRITE,
    PermissionCode.ORDER_RISK_WRITE,
    PermissionCode.ORDER_MERGE,
    PermissionCode.ORDER_HANDOVER,
  ],
  CONFIRMOR: [
    PermissionCode.ORDER_ASSIGN,
    PermissionCode.ORDER_VERIFY,
    PermissionCode.ORDER_NOTE_WRITE,
    PermissionCode.ORDER_RISK_WRITE,
  ],
  WAREHOUSE: [PermissionCode.ORDER_NOTE_WRITE, PermissionCode.ORDER_HANDOVER],
  FINANCE: [],
  OPTIMIZER: [],
};

function fixture(available = Object.values(RoleCode)) {
  const permissions = new Map<string, { id: string; code: string; description: string }>();
  const grants = new Set(['unrelated-role:unrelated-permission']);
  const tx = {
    permission: {
      upsert: vi.fn(async ({ create }: { create: { code: string; description: string } }) => {
        const row = permissions.get(create.code) ?? { id: create.code, ...create };
        permissions.set(create.code, row);
        return row;
      }),
    },
    role: { findMany: vi.fn(async () => available.map((code) => ({ id: code, code }))) },
    rolePermission: {
      createMany: vi.fn(
        async ({ data }: { data: { roleId: string; permissionId: string }[] }) => {
          const old = grants.size;
          data.forEach((row) => grants.add(`${row.roleId}:${row.permissionId}`));
          return { count: grants.size - old };
        },
      ),
    },
  };
  return {
    permissions,
    grants,
    prisma: { $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)) },
  };
}

async function reconcile(state: ReturnType<typeof fixture>) {
  const { reconcileOrderPermissions } = await import('./reconcile-order-permissions.js');
  return reconcileOrderPermissions(state.prisma as never);
}

describe('production order permission bootstrap', () => {
  it('starts only after the order permissions are reconciled', () => {
    const entrypoint = readFileSync(new URL('../docker-entrypoint.sh', import.meta.url), 'utf8');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(entrypoint).toContain('pnpm run rbac:reconcile-order-permissions');
    expect(entrypoint.indexOf('pnpm run rbac:reconcile-order-permissions')).toBeLessThan(
      entrypoint.indexOf('exec node dist/main'),
    );
    expect(pkg.scripts['rbac:reconcile-order-permissions']).toBe(
      'tsx prisma/reconcile-order-permissions-runner.ts',
    );
  });

  it('creates exactly the six order permissions in an unseeded upgrade', async () => {
    const state = fixture();
    await reconcile(state);
    expect([...state.permissions.keys()].sort()).toEqual(
      [
        PermissionCode.ORDER_ASSIGN,
        PermissionCode.ORDER_VERIFY,
        PermissionCode.ORDER_NOTE_WRITE,
        PermissionCode.ORDER_RISK_WRITE,
        PermissionCode.ORDER_MERGE,
        PermissionCode.ORDER_HANDOVER,
      ].sort(),
    );
  });

  it.each(Object.values(RoleCode))('grants only the approved order scope to %s', async (code) => {
    const state = fixture();
    await reconcile(state);
    const actual = [...state.grants]
      .filter((key) => key.startsWith(`${code}:`))
      .map((key) => key.split(':')[1])
      .sort();
    expect(actual).toEqual([...allowed[code]].sort());
  });

  it('is idempotent and preserves unrelated grants', async () => {
    const state = fixture();
    await reconcile(state);
    const grants = [...state.grants].sort();
    await reconcile(state);
    expect([...state.grants].sort()).toEqual(grants);
    expect(state.grants.has('unrelated-role:unrelated-permission')).toBe(true);
  });

  it('does not touch the permissions that already existed', async () => {
    const state = fixture();
    await reconcile(state);
    expect([...state.permissions.keys()].some((code) => code === PermissionCode.ORDER_VIEW_ALL)).toBe(
      false,
    );
  });
});
