import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PermissionCode, RoleCode } from '../src/generated/prisma/client.js';

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
  const { reconcileObservabilityViewPermissions } = await import('./reconcile-observability-view-permissions.js');
  return reconcileObservabilityViewPermissions(state.prisma as never);
}

describe('production observability-view permission bootstrap', () => {
  it('starts only after the observability-view permission is reconciled', () => {
    const entrypoint = readFileSync(new URL('../docker-entrypoint.sh', import.meta.url), 'utf8');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(entrypoint).toContain('pnpm run rbac:reconcile-observability-view');
    expect(entrypoint.indexOf('pnpm run rbac:reconcile-observability-view')).toBeLessThan(
      entrypoint.indexOf('exec node dist/main'),
    );
    expect(pkg.scripts['rbac:reconcile-observability-view']).toBe(
      'tsx prisma/reconcile-observability-view-permissions-runner.ts',
    );
  });

  it('upserts a full description for the permission', async () => {
    const state = fixture();
    const result = await reconcile(state);
    const row = state.permissions.get(PermissionCode.OBSERVABILITY_VIEW);
    expect(row?.description).toBe(
      'View the storefront intelligence workbench (overview and attribution quality).',
    );
    expect(result.permissionCount).toBe(1);
  });

  it('grants the view permission to super admins, admins and optimizers', async () => {
    const state = fixture();
    const result = await reconcile(state);
    expect(result.grantsCreated).toBe(3);
    expect(state.grants.has('SUPER_ADMIN:OBSERVABILITY_VIEW')).toBe(true);
    expect(state.grants.has('ADMIN:OBSERVABILITY_VIEW')).toBe(true);
    expect(state.grants.has('OPTIMIZER:OBSERVABILITY_VIEW')).toBe(true);
  });

  it('never grants the view permission to operational roles', async () => {
    const state = fixture();
    await reconcile(state);
    expect(state.grants.has('CONFIRMOR:OBSERVABILITY_VIEW')).toBe(false);
    expect(state.grants.has('WAREHOUSE:OBSERVABILITY_VIEW')).toBe(false);
    expect(state.grants.has('FINANCE:OBSERVABILITY_VIEW')).toBe(false);
  });

  it('reports roles that are missing from the database', async () => {
    const state = fixture([RoleCode.SUPER_ADMIN] as never);
    const result = await reconcile(state);
    expect(result.missingRoleCodes).toEqual(['ADMIN', 'OPTIMIZER']);
  });
});
