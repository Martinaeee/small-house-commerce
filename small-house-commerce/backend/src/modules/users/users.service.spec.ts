import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RoleCode } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

interface UserRow {
  id: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'DISABLED';
  passwordHash: string;
  roles: { role: { code: string } }[];
}

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: { permission: { code: string } }[];
}

const ROLE_IDS: Record<string, string> = {
  SUPER_ADMIN: 'role-super',
  ADMIN: 'role-admin',
  WAREHOUSE: 'role-warehouse',
};

/** The declaration order of the RoleCode enum in Postgres. */
const ROLE_ORDER = [
  'SUPER_ADMIN',
  'ADMIN',
  'OPTIMIZER',
  'CONFIRMOR',
  'WAREHOUSE',
  'FINANCE',
];

function role(code: string, permissions: string[] = []): RoleRow {
  return {
    id: ROLE_IDS[code] ?? `role-${code}`,
    code,
    name: code,
    description: `${code} description`,
    permissions: permissions.map((p) => ({ permission: { code: p } })),
  };
}

function user(id: string, roleCodes: string[], status: 'ACTIVE' | 'DISABLED' = 'ACTIVE'): UserRow {
  return {
    id,
    name: `Name ${id}`,
    email: `${id}@example.com`,
    status,
    passwordHash: `hash-${id}`,
    roles: roleCodes.map((code) => ({ role: { code } })),
  };
}

/**
 * Matches the subset of Prisma's `where` grammar the service uses for the
 * super-admin seat check: id !=, status equality and a `some` role filter.
 */
function matchesUser(row: UserRow, where: Record<string, any>): boolean {
  if (where.id?.not !== undefined && row.id === where.id.not) return false;
  if (where.id?.in !== undefined && !where.id.in.includes(row.id)) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  if (where.email !== undefined && row.email !== where.email) return false;
  const some = where.roles?.some;
  if (some?.role?.code !== undefined) {
    if (!row.roles.some((r) => r.role.code === some.role.code)) return false;
  }
  return true;
}

function makeService(seed: { users: UserRow[]; roles: RoleRow[] }) {
  const users = seed.users.map((u) => ({ ...u, roles: u.roles.map((r) => ({ ...r })) }));
  const roles = seed.roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => ({ ...p })) }));
  const revokedCalls: unknown[] = [];

  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        const found = users.find((u) =>
          where.id !== undefined ? u.id === where.id : u.email === where.email,
        );
        return found ? { ...found } : null;
      }),
      count: vi.fn(async ({ where }: { where: Record<string, any> }) =>
        users.filter((u) => matchesUser(u, where)).length,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const target = users.find((u) => u.id === where.id)!;
        if (data.name !== undefined) target.name = data.name;
        if (data.email !== undefined) target.email = data.email;
        if (data.status !== undefined) target.status = data.status;
        if (data.passwordHash !== undefined) target.passwordHash = data.passwordHash;
        if (data.roles) {
          target.roles = data.roles.create.map((entry: { roleId: string }) => ({
            role: { code: roles.find((r) => r.id === entry.roleId)!.code },
          }));
        }
        return { ...target };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const created = user(`created-${users.length + 1}`, []);
        Object.assign(created, data);
        users.push(created);
        return { ...created };
      }),
    },
    role: {
      findMany: vi.fn(async ({ where }: { where?: { code?: { in: string[] } } }) => {
        const codes = where?.code?.in;
        const matched = codes ? roles.filter((r) => codes.includes(r.code)) : roles;
        // Postgres sorts an enum column by its declaration order, not
        // alphabetically. The fake mirrors that.
        const ordered = [...matched].sort(
          (a, b) => ROLE_ORDER.indexOf(a.code) - ROLE_ORDER.indexOf(b.code),
        );
        return ordered.map((r) => ({ ...r }));
      }),
    },
    refreshToken: {
      updateMany: vi.fn(async (args: unknown) => {
        revokedCalls.push(args);
        return { count: 1 };
      }),
    },
  } as unknown as PrismaService;

  return { service: new UsersService(prisma), prisma, users, roles, revokedCalls };
}

const baseRoles = [
  role('SUPER_ADMIN', ['SYSTEM_SETTINGS_EDIT', 'ORDER_VIEW_ALL']),
  role('ADMIN', ['ORDER_VIEW_ALL']),
  role('WAREHOUSE', ['INVENTORY_VIEW']),
];

describe('UsersService.listRoles', () => {
  it('returns every role with its permission codes', async () => {
    const { service } = makeService({ users: [], roles: baseRoles });

    const roles = await service.listRoles();

    expect(roles.map((r) => r.code)).toEqual(['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE']);
    expect(roles.find((r) => r.code === 'SUPER_ADMIN')?.permissionCodes).toEqual([
      'SYSTEM_SETTINGS_EDIT',
      'ORDER_VIEW_ALL',
    ]);
  });
});

describe('UsersService.update — self protection', () => {
  it('refuses to disable the acting account', async () => {
    const { service } = makeService({
      users: [user('u-1', ['SUPER_ADMIN']), user('u-2', ['SUPER_ADMIN'])],
      roles: baseRoles,
    });

    await expect(
      service.update('u-1', { status: 'DISABLED' }, 'u-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to change the acting account roles', async () => {
    const { service } = makeService({
      users: [user('u-1', ['SUPER_ADMIN']), user('u-2', ['SUPER_ADMIN'])],
      roles: baseRoles,
    });

    await expect(
      service.update('u-1', { roleCodes: [RoleCode.ADMIN] }, 'u-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still allows renaming yourself', async () => {
    const { service } = makeService({
      users: [user('u-1', ['SUPER_ADMIN'])],
      roles: baseRoles,
    });

    const updated = await service.update('u-1', { name: 'Renamed' }, 'u-1');

    expect(updated.name).toBe('Renamed');
  });
});

describe('UsersService.update — last super admin guard', () => {
  it('refuses to disable the only active super admin', async () => {
    const { service } = makeService({
      users: [user('u-1', ['SUPER_ADMIN']), user('u-2', ['ADMIN'])],
      roles: baseRoles,
    });

    await expect(
      service.update('u-1', { status: 'DISABLED' }, 'u-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to strip SUPER_ADMIN from the only active super admin', async () => {
    const { service } = makeService({
      users: [user('u-1', ['SUPER_ADMIN']), user('u-2', ['ADMIN'])],
      roles: baseRoles,
    });

    await expect(
      service.update('u-1', { roleCodes: [RoleCode.ADMIN] }, 'u-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows stripping SUPER_ADMIN when another active super admin remains', async () => {
    const { service, users } = makeService({
      users: [user('u-1', ['SUPER_ADMIN']), user('u-2', ['SUPER_ADMIN'])],
      roles: baseRoles,
    });

    await service.update('u-1', { roleCodes: [RoleCode.ADMIN] }, 'u-2');

    expect(users.find((u) => u.id === 'u-1')?.roles.map((r) => r.role.code)).toEqual(['ADMIN']);
  });

  it('allows disabling a super admin when another active super admin remains', async () => {
    const { service, users } = makeService({
      users: [user('u-1', ['SUPER_ADMIN']), user('u-2', ['SUPER_ADMIN'])],
      roles: baseRoles,
    });

    await service.update('u-1', { status: 'DISABLED' }, 'u-2');

    expect(users.find((u) => u.id === 'u-1')?.status).toBe('DISABLED');
  });

  it('ignores a disabled super admin that is already out of office', async () => {
    const { service, users } = makeService({
      users: [user('u-1', ['SUPER_ADMIN'], 'DISABLED'), user('u-2', ['ADMIN'])],
      roles: baseRoles,
    });

    await service.update('u-1', { roleCodes: [RoleCode.ADMIN] }, 'u-2');

    expect(users.find((u) => u.id === 'u-1')?.roles[0]?.role.code).toBe('ADMIN');
  });

  it('does not block non-super-admin members', async () => {
    const { service, users } = makeService({
      users: [user('u-1', ['SUPER_ADMIN']), user('u-2', ['ADMIN'])],
      roles: baseRoles,
    });

    await service.update('u-2', { status: 'DISABLED' }, 'u-1');

    expect(users.find((u) => u.id === 'u-2')?.status).toBe('DISABLED');
  });
});

describe('UsersService.update — password reset', () => {
  it('revokes the member sessions when the password is replaced', async () => {
    const { service, revokedCalls } = makeService({
      users: [user('u-1', ['SUPER_ADMIN']), user('u-2', ['WAREHOUSE'])],
      roles: baseRoles,
    });

    await service.update('u-2', { password: 'new-password-1' }, 'u-1');

    expect(revokedCalls).toHaveLength(1);
    expect(revokedCalls[0]).toMatchObject({
      where: { userId: 'u-2', revokedAt: null },
    });
  });

  it('does not revoke sessions when only the name changes', async () => {
    const { service, revokedCalls } = makeService({
      users: [user('u-1', ['SUPER_ADMIN']), user('u-2', ['WAREHOUSE'])],
      roles: baseRoles,
    });

    await service.update('u-2', { name: 'Renamed' }, 'u-1');

    expect(revokedCalls).toHaveLength(0);
  });
});

describe('UsersService.update — validation', () => {
  it('throws when the member does not exist', async () => {
    const { service } = makeService({ users: [], roles: baseRoles });

    await expect(service.update('missing', { name: 'x' }, 'u-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws on a duplicate email', async () => {
    const { service } = makeService({
      users: [user('u-1', ['SUPER_ADMIN']), user('u-2', ['WAREHOUSE'])],
      roles: baseRoles,
    });

    await expect(
      service.update('u-2', { email: 'u-1@example.com' }, 'u-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
