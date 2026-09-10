import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { normalizePhilippinePhone } from '../../common/phone.util.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  CreateCustomerInput,
  CustomerAddressInput,
  CustomerAddressUpdateInput,
  CustomerQuery,
  UpdateCustomerInput,
} from './dto/customer.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  // --- customers -----------------------------------------------------------

  async list(query: CustomerQuery) {
    const where: Prisma.CustomerWhereInput = {};

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { normalizedPhone: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.riskLevel) where.currentRiskLevel = query.riskLevel;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { addresses: { orderBy: { createdAt: 'asc' } } },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async create(input: CreateCustomerInput) {
    const normalizedPhone = this.normalizeOrThrow(input.phone);

    try {
      return await this.prisma.customer.create({
        data: {
          name: input.name ?? null,
          normalizedPhone,
          email: input.email ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A customer with this phone number already exists');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateCustomerInput) {
    await this.ensureExists(id);

    const data: Prisma.CustomerUpdateInput = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    if (input.riskLevel !== undefined) data.currentRiskLevel = input.riskLevel;
    if (input.phone !== undefined) data.normalizedPhone = this.normalizeOrThrow(input.phone);

    try {
      return await this.prisma.customer.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A customer with this phone number already exists');
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.ensureExists(id);

    // Addresses are removed by cascade.
    await this.prisma.customer.delete({ where: { id } });
    return { ok: true };
  }

  // --- addresses -----------------------------------------------------------

  async listAddresses(customerId: string) {
    await this.ensureExists(customerId);

    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addAddress(customerId: string, input: CustomerAddressInput) {
    await this.ensureExists(customerId);

    return this.prisma.customerAddress.create({
      data: { customerId, ...input },
    });
  }

  async updateAddress(customerId: string, addressId: string, input: CustomerAddressUpdateInput) {
    await this.ensureExists(customerId);

    const address = await this.prisma.customerAddress.findUnique({ where: { id: addressId } });
    if (!address || address.customerId !== customerId) {
      throw new NotFoundException('Address not found');
    }

    return this.prisma.customerAddress.update({ where: { id: addressId }, data: input });
  }

  async removeAddress(customerId: string, addressId: string) {
    await this.ensureExists(customerId);

    const address = await this.prisma.customerAddress.findUnique({ where: { id: addressId } });
    if (!address || address.customerId !== customerId) {
      throw new NotFoundException('Address not found');
    }

    await this.prisma.customerAddress.delete({ where: { id: addressId } });
    return { ok: true };
  }

  // --- helpers -------------------------------------------------------------

  private normalizeOrThrow(phone: string): string {
    const normalized = normalizePhilippinePhone(phone);

    if (!normalized) {
      throw new BadRequestException(
        `Invalid Philippine phone number: "${phone}" (expected e.g. 09171234567, +639171234567, 639171234567)`,
      );
    }

    return normalized;
  }

  private async ensureExists(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
  }
}
