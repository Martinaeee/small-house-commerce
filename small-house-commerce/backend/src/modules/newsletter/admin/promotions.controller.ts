import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { PromotionService } from '../promotion.service.js';
import {
  createPromotionSchema,
  updatePromotionSchema,
  type CreatePromotionInput,
  type UpdatePromotionInput,
} from '../dto/promotion.dto.js';

/**
 * Promotion management is money-affecting, so it shares the settings page's
 * SYSTEM_SETTINGS_EDIT guard (SUPER_ADMIN only) rather than NEWSLETTER_WRITE.
 */
@Controller('admin/newsletter/promotions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class AdminPromotionsController {
  constructor(private readonly promotions: PromotionService) {}

  @Get()
  list() {
    return this.promotions.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createPromotionSchema))
    body: CreatePromotionInput,
  ) {
    return this.promotions.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePromotionSchema))
    body: UpdatePromotionInput,
  ) {
    return this.promotions.update(id, body);
  }

  @Get(':id/usage')
  usage(@Param('id', ParseUUIDPipe) id: string) {
    return this.promotions.usage(id);
  }
}
