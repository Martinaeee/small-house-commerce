import { Controller, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ApplyVerifiedResultService } from '../apply-verified-result.service.js';

/**
 * Asks SUNRATE about a payment that is still open. Reading the order list
 * is enough for this — the query changes nothing but the query log — so it
 * takes the same permission as reading orders.
 */
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('ORDER_VIEW_ALL')
export class PaymentsQueryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apply: ApplyVerifiedResultService,
  ) {}

  @Post('orders/:orderNumber/query')
  async query(@Param('orderNumber') orderNumber: string) {
    const attempt = await this.prisma.sunratePaymentAttempt.findFirst({
      where: {
        order: { orderNumber },
        status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!attempt) throw new NotFoundException('This order has no open payment attempt');
    return this.apply.reconcile(attempt.id, 'ADMIN');
  }
}
