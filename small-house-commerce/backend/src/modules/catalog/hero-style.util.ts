import type {
  HeroOwnerType,
  HeroStyle,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { HeroStyleInput } from './dto/hero-style.dto.js';

/**
 * HeroStyle rows are polymorphic (a category and a collection can both own
 * one), so they carry no relation to their owner. These two helpers are the
 * only places that know how to write and read them back.
 */

/**
 * Applies an incoming hero style. Takes a transaction client so the owner row
 * and its style are written atomically.
 * `undefined` = the caller did not send the field → leave the stored row
 * alone; `null` = clear it; an object = upsert.
 */
export async function saveHeroStyle(
  db: Prisma.TransactionClient,
  ownerType: HeroOwnerType,
  ownerId: string,
  input: HeroStyleInput | null | undefined,
): Promise<void> {
  if (input === undefined) return;

  if (input === null) {
    await db.heroStyle.deleteMany({ where: { ownerType, ownerId } });
    return;
  }

  await db.heroStyle.upsert({
    where: { ownerType_ownerId: { ownerType, ownerId } },
    create: { ownerType, ownerId, ...input },
    update: input,
  });
}

/** Hero styles for a set of owners, keyed by ownerId (missing = no style). */
export async function loadHeroStyles(
  prisma: PrismaService,
  ownerType: HeroOwnerType,
  ownerIds: string[],
): Promise<Map<string, HeroStyle>> {
  if (ownerIds.length === 0) return new Map();

  const rows = await prisma.heroStyle.findMany({
    where: { ownerType, ownerId: { in: ownerIds } },
  });
  return new Map(rows.map((row) => [row.ownerId, row]));
}
