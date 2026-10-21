import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { BackInStockService } from '../back-in-stock.service.js';
import {
  backInStockQuerySchema,
  type BackInStockQuery,
} from '../dto/back-in-stock.dto.js';

@Controller('admin/newsletter/back-in-stock')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('NEWSLETTER_READ')
export class AdminBackInStockController {
  constructor(private readonly backInStock: BackInStockService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(backInStockQuerySchema))
    query: BackInStockQuery,
  ) {
    return this.backInStock.list(query);
  }

  @Post(':id/resend')
  @Permissions('NEWSLETTER_WRITE')
  resend(@Param('id', ParseUUIDPipe) id: string) {
    return this.backInStock.resend(id);
  }
}
