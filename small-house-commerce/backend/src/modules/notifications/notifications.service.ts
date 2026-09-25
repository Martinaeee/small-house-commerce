import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PermissionCode } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { attentionWhere } from '../catalog/admin-product-attention.js';
import {
  ADMIN_NOTIFICATION_HREFS,
  type AdminNotificationItem,
  type AdminNotificationKind,
  type AdminNotificationsResponse,
} from './notifications.types.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notifications(userId: string): Promise<AdminNotificationsResponse> {
    const permissions = await this.permissionsForActiveUser(userId);
    const now = new Date();
    const jobs: Promise<AdminNotificationItem>[] = [];

    if (permissions.has('ORDER_CONFIRM')) {
      jobs.push(
        this.count('ORDER_NEEDS_REVIEW',
          this.prisma.order.count({
            where: { confirmationStatus: 'NEEDS_REVIEW' },
          }),
        ),
        this.count('ORDER_UNCONFIRMED',
          this.prisma.order.count({
            where: { confirmationStatus: 'UNCONFIRMED' },
          }),
        ),
      );
    }

    if (permissions.has('PRODUCT_MANAGE')) {
      jobs.push(
        this.count('PRODUCT_MISSING_MEDIA',
          this.prisma.product.count({
            where: attentionWhere('missing_media'),
          }),
        ),
        this.count('PRODUCT_NO_PRICED_SKU',
          this.prisma.product.count({
            where: attentionWhere('no_priced_sku'),
          }),
        ),
        this.count('PRODUCT_INCOMPLETE_SHIPPING',
          this.prisma.product.count({
            where: attentionWhere('incomplete_shipping'),
          }),
        ),
        this.count('PRODUCT_STALE_DRAFT',
          this.prisma.product.count({
            where: attentionWhere('stale_draft', now),
          }),
        ),
      );
    }

    const items = (await Promise.all(jobs)).filter((item) => item.count > 0);
    return {
      totalCount: items.reduce((sum, item) => sum + item.count, 0),
      items,
    };
  }

  private async count(
    kind: AdminNotificationKind,
    pending: Promise<number>,
  ): Promise<AdminNotificationItem> {
    return {
      kind,
      count: await pending,
      href: ADMIN_NOTIFICATION_HREFS[kind],
    };
  }

  private async permissionsForActiveUser(
    userId: string,
  ): Promise<Set<PermissionCode>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException();
    }

    return new Set(
      user.roles.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => permission.code),
      ),
    );
  }
}
