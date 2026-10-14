import { describe, expect, it, vi } from "vitest";
import { RoleCode } from "../src/generated/prisma/client.js";
import { reconcileStorefrontShellPermission } from "./reconcile-storefront-shell-permission.js";

interface PermissionRow {
  id: string;
  code: string;
  description: string | null;
}

interface RbacState {
  permissions: PermissionRow[];
  grants: Set<string>;
}

const roles = Object.values(RoleCode).map((code, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  code,
}));

function grantKey(roleId: string, permissionId: string): string {
  return `${roleId}:${permissionId}`;
}

function roleId(code: RoleCode): string {
  return roles.find((role) => role.code === code)!.id;
}

function fakePrisma(state: RbacState, availableRoles = roles) {
  const transaction = {
    permission: {
      upsert: vi.fn(async ({ create, update }: {
        create: Omit<PermissionRow, "id"> & { id?: string };
        update: Pick<PermissionRow, "description">;
      }) => {
        const existing = state.permissions.find(
          (permission) => permission.code === create.code,
        );
        if (existing) {
          existing.description = update.description;
          return existing;
        }
        const created: PermissionRow = {
          id: create.id ?? "10000000-0000-4000-8000-000000000002",
          code: create.code,
          description: create.description,
        };
        state.permissions.push(created);
        return created;
      }),
    },
    role: {
      findMany: vi.fn(async () =>
        availableRoles.filter((role) => role.code === RoleCode.SUPER_ADMIN),
      ),
    },
    rolePermission: {
      createMany: vi.fn(async ({ data }: {
        data: { roleId: string; permissionId: string }[];
      }) => {
        const before = state.grants.size;
        for (const grant of data) {
          state.grants.add(grantKey(grant.roleId, grant.permissionId));
        }
        return { count: state.grants.size - before };
      }),
    },
  };

  return {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
}

function existingPermission(): PermissionRow {
  return {
    id: "10000000-0000-4000-8000-000000000002",
    code: "STOREFRONT_SHELL_MANAGE",
    description: "Old description",
  };
}

describe("production storefront-shell RBAC reconciliation", () => {
  it("creates STOREFRONT_SHELL_MANAGE and grants it only to SUPER_ADMIN", async () => {
    const state: RbacState = { permissions: [], grants: new Set() };

    const result = await reconcileStorefrontShellPermission(
      fakePrisma(state) as never,
    );

    expect(state.permissions).toEqual([
      expect.objectContaining({
        code: "STOREFRONT_SHELL_MANAGE",
        description:
          "Edit and publish the storefront Header, Footer, brand marks and base theme.",
      }),
    ]);
    expect(state.grants).toEqual(
      new Set([grantKey(roleId(RoleCode.SUPER_ADMIN), result.permissionId)]),
    );
    expect(result.grantedRoleCodes).toEqual([RoleCode.SUPER_ADMIN]);
  });

  it("preserves every unrelated grant and never grants another role", async () => {
    const permission = existingPermission();
    const unrelatedGrant = grantKey(
      roleId(RoleCode.ADMIN),
      "20000000-0000-4000-8000-000000000001",
    );
    const state: RbacState = {
      permissions: [permission],
      grants: new Set([unrelatedGrant]),
    };

    await reconcileStorefrontShellPermission(fakePrisma(state) as never);

    expect(state.grants).toContain(unrelatedGrant);
    expect(state.grants).toContain(
      grantKey(roleId(RoleCode.SUPER_ADMIN), permission.id),
    );
    for (const code of Object.values(RoleCode).filter(
      (code) => code !== RoleCode.SUPER_ADMIN,
    )) {
      expect(state.grants).not.toContain(grantKey(roleId(code), permission.id));
    }
  });

  it("keeps a blank database bootstrappable without creating roles", async () => {
    const state: RbacState = { permissions: [], grants: new Set() };

    const result = await reconcileStorefrontShellPermission(
      fakePrisma(state, []) as never,
    );

    expect(state.permissions).toHaveLength(1);
    expect(state.grants).toEqual(new Set());
    expect(result.missingRoleCodes).toEqual([RoleCode.SUPER_ADMIN]);
  });

  it("is idempotent when executed twice", async () => {
    const state: RbacState = { permissions: [], grants: new Set() };
    const prisma = fakePrisma(state);

    await reconcileStorefrontShellPermission(prisma as never);
    const first = {
      permissions: structuredClone(state.permissions),
      grants: [...state.grants],
    };
    const second = await reconcileStorefrontShellPermission(prisma as never);

    expect({ permissions: state.permissions, grants: [...state.grants] }).toEqual(first);
    expect(second.grantsCreated).toBe(0);
  });
});
