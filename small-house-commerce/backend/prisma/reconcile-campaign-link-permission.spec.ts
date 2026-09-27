import { describe, expect, it, vi } from "vitest";
import { RoleCode } from "../src/generated/prisma/client.js";
import { reconcileCampaignLinkPermission } from "./reconcile-campaign-link-permission.js";

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

function fakePrisma(
  state: RbacState,
  availableRoles = roles,
) {
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
          id: create.id ?? "10000000-0000-4000-8000-000000000001",
          code: create.code,
          description: create.description,
        };
        state.permissions.push(created);
        return created;
      }),
    },
    role: {
      findMany: vi.fn(async () =>
        availableRoles.filter((role) =>
          [RoleCode.SUPER_ADMIN, RoleCode.ADMIN, RoleCode.OPTIMIZER].includes(
            role.code,
          ),
        ),
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
    id: "10000000-0000-4000-8000-000000000001",
    code: "CAMPAIGN_LINK_BUILD",
    description: "Old description",
  };
}

describe("production campaign-link RBAC reconciliation", () => {
  it("creates CAMPAIGN_LINK_BUILD when the permission is absent", async () => {
    const state: RbacState = { permissions: [], grants: new Set() };

    await reconcileCampaignLinkPermission(fakePrisma(state) as never);

    expect(state.permissions).toEqual([
      expect.objectContaining({
        code: "CAMPAIGN_LINK_BUILD",
        description: "Build public product, variant and attribution links.",
      }),
    ]);
  });

  it("does not duplicate an existing permission", async () => {
    const permission = existingPermission();
    const state: RbacState = { permissions: [permission], grants: new Set() };

    await reconcileCampaignLinkPermission(fakePrisma(state) as never);

    expect(state.permissions).toHaveLength(1);
    expect(state.permissions[0]).toMatchObject({
      id: permission.id,
      description: "Build public product, variant and attribution links.",
    });
  });

  it.each([RoleCode.SUPER_ADMIN, RoleCode.ADMIN, RoleCode.OPTIMIZER])(
    "grants CAMPAIGN_LINK_BUILD to %s",
    async (code) => {
      const permission = existingPermission();
      const state: RbacState = { permissions: [permission], grants: new Set() };

      await reconcileCampaignLinkPermission(fakePrisma(state) as never);

      expect(state.grants).toContain(grantKey(roleId(code), permission.id));
    },
  );

  it("does not grant CAMPAIGN_LINK_BUILD to other roles", async () => {
    const permission = existingPermission();
    const state: RbacState = { permissions: [permission], grants: new Set() };

    await reconcileCampaignLinkPermission(fakePrisma(state) as never);

    for (const code of [
      RoleCode.CONFIRMOR,
      RoleCode.WAREHOUSE,
      RoleCode.FINANCE,
    ]) {
      expect(state.grants).not.toContain(grantKey(roleId(code), permission.id));
    }
  });

  it("preserves every existing role grant", async () => {
    const permission = existingPermission();
    const unrelatedGrant = grantKey(
      roleId(RoleCode.WAREHOUSE),
      "20000000-0000-4000-8000-000000000001",
    );
    const state: RbacState = {
      permissions: [permission],
      grants: new Set([unrelatedGrant]),
    };

    await reconcileCampaignLinkPermission(fakePrisma(state) as never);

    expect(state.grants).toContain(unrelatedGrant);
  });

  it("keeps a blank database bootstrappable without creating roles", async () => {
    const state: RbacState = { permissions: [], grants: new Set() };

    const result = await reconcileCampaignLinkPermission(
      fakePrisma(state, []) as never,
    );

    expect(state.permissions).toHaveLength(1);
    expect(state.grants).toEqual(new Set());
    expect(result.missingRoleCodes).toEqual([
      RoleCode.SUPER_ADMIN,
      RoleCode.ADMIN,
      RoleCode.OPTIMIZER,
    ]);
  });

  it("is idempotent when executed twice", async () => {
    const state: RbacState = { permissions: [], grants: new Set() };
    const prisma = fakePrisma(state);

    await reconcileCampaignLinkPermission(prisma as never);
    const first = {
      permissions: structuredClone(state.permissions),
      grants: [...state.grants].sort(),
    };
    await reconcileCampaignLinkPermission(prisma as never);

    expect({
      permissions: state.permissions,
      grants: [...state.grants].sort(),
    }).toEqual(first);
  });
});
