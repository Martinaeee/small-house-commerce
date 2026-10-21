import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { Permissions } from '../../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../../auth/permissions.guard.js';
import { SharedFaqService } from '../shared-faq.service.js';

/**
 * Read-only preview of the shared library for the product editor.
 *
 * Guarded by PRODUCT_MANAGE rather than PRODUCT_FAQ_SHARED_MANAGE: an operator
 * who may edit one product's questions must be able to see which shared
 * questions that product renders, without gaining the right to rewrite the
 * library every other product borrows from.
 */
@Controller('admin/faq/shared')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminSharedFaqPreviewController {
  constructor(private readonly sharedFaq: SharedFaqService) {}

  @Get('preview')
  async preview() {
    const set = await this.sharedFaq.get();
    return { items: set.items };
  }
}
