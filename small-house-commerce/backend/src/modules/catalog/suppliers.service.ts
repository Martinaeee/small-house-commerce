import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateSupplierInput, UpdateSupplierInput } from './dto/supplier.dto.js';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });

    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    return supplier;
  }

  async create(input: CreateSupplierInput) {
    try {
      return await this.prisma.supplier.create({ data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A supplier with the same unique value already exists');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateSupplierInput) {
    await this.ensureExists(id);

    try {
      return await this.prisma.supplier.update({ where: { id }, data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A supplier with the same unique value already exists');
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.ensureExists(id);

    // SKUs referencing this supplier keep their rows (onDelete: SetNull).
    await this.prisma.supplier.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
  }
}
