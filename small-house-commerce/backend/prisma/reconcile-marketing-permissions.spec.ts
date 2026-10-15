import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PermissionCode, RoleCode } from '../src/generated/prisma/client.js';

const allowed = {
  SUPER_ADMIN: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN', 'MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'],
  ADMIN: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN', 'MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'],
  OPTIMIZER: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'],
  FINANCE: ['MARKETING_VIEW_ALL'],
  CONFIRMOR: [],
  WAREHOUSE: [],
};
function fixture(available = Object.values(RoleCode)) {
  const permissions = new Map<string, { id: string; code: string; description: string }>();
  const grants = new Set(['unrelated-role:unrelated-permission']);
  const tx = {
    permission: { upsert: vi.fn(async ({ create }: { create: { code: string; description: string } }) => {
      const row = permissions.get(create.code) ?? { id: create.code, ...create };
      permissions.set(create.code, row);
      return row;
    }) },
    role: { findMany: vi.fn(async () => available.map(code => ({ id: code, code }))) },
    rolePermission: { createMany: vi.fn(async ({ data }: { data: { roleId: string; permissionId: string }[] }) => {
      const old = grants.size;
      data.forEach(row => grants.add(`${row.roleId}:${row.permissionId}`));
      return { count: grants.size - old };
    }) },
  };
  return { permissions, grants, prisma: { $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)) } };
}
async function reconcile(state: ReturnType<typeof fixture>) {
  const { reconcileMarketingPermissions } = await import('./reconcile-marketing-permissions.js');
  return reconcileMarketingPermissions(state.prisma as never);
}
describe('production Marketing permission bootstrap', () => {
  it('starts only after Marketing permissions are reconciled', () => {
    const entrypoint = readFileSync(new URL('../docker-entrypoint.sh', import.meta.url), 'utf8');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(entrypoint).toContain('pnpm run rbac:reconcile-marketing');
    expect(entrypoint.indexOf('pnpm run rbac:reconcile-marketing')).toBeLessThan(entrypoint.indexOf('exec node dist/main'));
    expect(pkg.scripts['rbac:reconcile-marketing']).toBe('tsx prisma/reconcile-marketing-permissions-runner.ts');
  });
  it('creates exactly the four Marketing permissions in an unseeded upgrade', async () => {
    const state = fixture();
    await reconcile(state);
    expect([...state.permissions.keys()].sort()).toEqual([
      PermissionCode.MARKETING_MANAGE_ALL, PermissionCode.MARKETING_MANAGE_OWN,
      PermissionCode.MARKETING_VIEW_ALL, PermissionCode.MARKETING_VIEW_OWN,
    ].sort());
  });
  it.each(Object.values(RoleCode))('grants only the approved Marketing scope to %s', async code => {
    const state = fixture();
    await reconcile(state);
    const actual = [...state.grants].filter(key => key.startsWith(`${code}:`)).map(key => key.split(':')[1]).sort();
    expect(actual).toEqual([...allowed[code]].sort());
  });
  it('is idempotent and preserves non-Marketing grants', async () => {
    const state = fixture();
    const first = await reconcile(state);
    const grants = [...state.grants].sort();
    const second = await reconcile(state);
    expect(first.grantsCreated).toBe(11);
    expect(second.grantsCreated).toBe(0);
    expect([...state.grants].sort()).toEqual(grants);
    expect(state.grants).toContain('unrelated-role:unrelated-permission');
    expect(state.permissions.size).toBe(4);
  });
  it('does not create absent roles or widen their scope', async () => {
    const state = fixture([]);
    const result = await reconcile(state);
    expect(result.grantsCreated).toBe(0);
    expect(state.permissions.size).toBe(4);
    expect(state.grants).toEqual(new Set(['unrelated-role:unrelated-permission']));
    expect(result.missingRoleCodes.sort()).toEqual([RoleCode.SUPER_ADMIN, RoleCode.ADMIN, RoleCode.OPTIMIZER, RoleCode.FINANCE].sort());
  });
});
