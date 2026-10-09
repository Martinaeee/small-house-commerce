import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { normaliseAid } from './marketing-attribution.js';

export type OptimizerStatusValue = 'ACTIVE' | 'DISABLED';

/**
 * Reads the Prisma error code without an `instanceof` check, so both a real
 * PrismaClientKnownRequestError and a test double are recognised.
 */
function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Optimizer identity (DATABASE.md §7-8). One profile per admin user, each with
 * the stable AID that order attribution is keyed on. `optimizer_id` columns on
 * orders and attributions store User.id, so this service is the only place that
 * maps between a User and its AID.
 */
@Injectable()
export class OptimizersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.optimizerProfile.findMany({
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        userId: true,
        aid: true,
        displayName: true,
        status: true,
      },
    });
  }

  async create(input: { userId: string; aid: string; displayName: string }) {
    const aid = normaliseAid(input.aid);
    if (!aid) {
      throw new BadRequestException(
        'AID must be 1-64 letters, digits, dots, underscores or dashes, starting with a letter or digit.',
      );
    }
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw new BadRequestException('Display name is required.');
    }

    try {
      return await this.prisma.optimizerProfile.create({
        data: { userId: input.userId, aid, displayName },
      });
    } catch (error) {
      if (prismaErrorCode(error) === 'P2002') {
        throw new ConflictException(
          'This AID is already taken, or the user already has an optimizer profile.',
        );
      }
      throw error;
    }
  }

  async updateStatus(id: string, status: OptimizerStatusValue) {
    try {
      return await this.prisma.optimizerProfile.update({
        where: { id },
        data: { status },
      });
    } catch (error) {
      if (prismaErrorCode(error) === 'P2025') {
        throw new NotFoundException('Optimizer profile not found.');
      }
      throw error;
    }
  }

  /**
   * Attribution lookup. Returns null for an unusable or unknown AID: an unknown
   * AID must never invent an owner, it just leaves the order unattributed.
   */
  async resolveByAid(raw: string) {
    const aid = normaliseAid(raw);
    if (!aid) return null;
    return this.prisma.optimizerProfile.findUnique({
      where: { aid },
      select: { id: true, userId: true, displayName: true, status: true },
    });
  }
}
