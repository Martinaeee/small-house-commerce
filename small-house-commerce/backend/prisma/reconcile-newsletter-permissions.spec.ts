import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { PermissionCode, RoleCode } from "../src/generated/prisma/client.js";
import { reconcileNewsletterPermissions } from "./reconcile-newsletter-permissions.js";

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
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  code,
}));
const targetRoles = new Set<RoleCode>([
  RoleCode.SUPER_ADMIN,
  RoleCode.ADMIN,
]);

function grantKey(roleId: string, permissionId: string): string {
  return `${roleId}:${permissionId}`;
}

function fakePrisma(state: RbacState, availableRoles = roles) {
  const transaction = {
    permission: {
      upsert: vi.fn(async ({ create, update }: {
        create: Omit<PermissionRow, "id">;
        update: Pick<PermissionRow, "description">;
      }) => {
        const existing = state.permissions.find(
          (permission) => permission.code === create.code,
        );
        if (existing) {
          existing.description = update.description;
          return { id: existing.id, code: existing.code };
        }
        const created: PermissionRow = {
          id: `10000000-0000-4000-8000-${String(
            state.permissions.length + 1,
          ).padStart(12, "0")}`,
          ...create,
        };
        state.permissions.push(created);
        return { id: created.id, code: created.code };
      }),
    },
    role: {
      findMany: vi.fn(async () =>
        availableRoles.filter((role) => targetRoles.has(role.code)),
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

function roleId(code: RoleCode): string {
  return roles.find((role) => role.code === code)!.id;
}

describe("production newsletter RBAC reconciliation", () => {
  it("creates both permissions and grants them to SUPER_ADMIN and ADMIN", async () => {
    const state: RbacState = { permissions: [], grants: new Set() };

    const result = await reconcileNewsletterPermissions(fakePrisma(state) as never);

    expect(state.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: PermissionCode.NEWSLETTER_READ }),
        expect.objectContaining({ code: PermissionCode.NEWSLETTER_WRITE }),
      ]),
    );
    for (const role of [RoleCode.SUPER_ADMIN, RoleCode.ADMIN]) {
      for (const permission of state.permissions) {
        expect(state.grants).toContain(grantKey(roleId(role), permission.id));
      }
    }
    expect(result.grantsCreated).toBe(4);
  });

  it("does not grant newsletter permissions to other roles", async () => {
    const state: RbacState = { permissions: [], grants: new Set() };

    await reconcileNewsletterPermissions(fakePrisma(state) as never);

    for (const role of [
      RoleCode.OPTIMIZER,
      RoleCode.CONFIRMOR,
      RoleCode.WAREHOUSE,
      RoleCode.FINANCE,
    ]) {
      for (const permission of state.permissions) {
        expect(state.grants).not.toContain(grantKey(roleId(role), permission.id));
      }
    }
  });

  it("preserves existing grants and is idempotent", async () => {
    const unrelated = "role-existing:permission-existing";
    const state: RbacState = {
      permissions: [],
      grants: new Set([unrelated]),
    };
    const prisma = fakePrisma(state);

    await reconcileNewsletterPermissions(prisma as never);
    const second = await reconcileNewsletterPermissions(prisma as never);

    expect(state.permissions).toHaveLength(2);
    expect(state.grants).toContain(unrelated);
    expect(second.grantsCreated).toBe(0);
  });

  it("keeps a blank database bootstrappable when roles do not exist yet", async () => {
    const state: RbacState = { permissions: [], grants: new Set() };

    const result = await reconcileNewsletterPermissions(
      fakePrisma(state, []) as never,
    );

    expect(state.permissions).toHaveLength(2);
    expect(state.grants).toEqual(new Set());
    expect(result.missingRoleCodes).toEqual([
      RoleCode.SUPER_ADMIN,
      RoleCode.ADMIN,
    ]);
  });

  it("runs the idempotent reconcile after migrations and before API startup", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    const entrypoint = await readFile(
      new URL("../docker-entrypoint.sh", import.meta.url),
      "utf8",
    );

    expect(packageJson.scripts["rbac:reconcile-newsletter"]).toBe(
      "tsx prisma/reconcile-newsletter-permissions-runner.ts",
    );
    const migrateAt = entrypoint.indexOf("prisma migrate deploy");
    const reconcileAt = entrypoint.indexOf("rbac:reconcile-newsletter");
    const startAt = entrypoint.indexOf("exec node dist/main");
    expect(migrateAt).toBeGreaterThanOrEqual(0);
    expect(reconcileAt).toBeGreaterThan(migrateAt);
    expect(startAt).toBeGreaterThan(reconcileAt);
  });
});
