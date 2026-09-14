// src/modules/catalog/admin/reviews.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  batchReviewsSchema,
  createAdminReviewSchema,
  updateAdminReviewSchema,
  type BatchReviewsInput,
  type CreateAdminReviewInput,
  type UpdateAdminReviewInput,
} from '../dto/review.dto.js';
import { ReviewsService } from '../reviews.service.js';

/**
 * Admin review entry points. Cold-start reviews are merchant-authored; the
 * guard/permission pair matches AdminProductsController. Two base paths need
 * two controller classes, both declared in this file.
 */
@Controller('admin/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminProductReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':productId/reviews')
  list(@Param('productId') productId: string) {
    return this.reviews.adminListForProduct(productId);
  }

  @Post(':productId/reviews/batch')
  batchCreate(
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(batchReviewsSchema)) body: BatchReviewsInput,
  ) {
    return this.reviews.adminBatchCreate(productId, body.items);
  }

  @Post(':productId/reviews')
  create(
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(createAdminReviewSchema)) input: CreateAdminReviewInput,
  ) {
    return this.reviews.adminCreate(productId, input);
  }
}

@Controller('admin/reviews')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAdminReviewSchema)) input: UpdateAdminReviewInput,
  ) {
    return this.reviews.adminUpdate(id, input);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.reviews.adminRemove(id);
  }
}
