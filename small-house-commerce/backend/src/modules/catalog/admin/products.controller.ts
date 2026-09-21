import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  adminProductQuerySchema,
  createProductSchema,
  updateProductSchema,
  type AdminProductQuery,
  type CreateProductInput,
  type UpdateProductInput,
} from '../dto/product.dto.js';
import {
  CatalogGraphVersionMismatchError,
  CatalogGraphVersionRequiredError,
} from '../dto/catalog-graph.dto.js';
import { ProductsService } from '../products.service.js';

@Controller('admin/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(adminProductQuerySchema))
    query: AdminProductQuery,
  ) {
    return this.products.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createProductSchema)) input: CreateProductInput,
  ) {
    return this.products.create(input);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) input: UpdateProductInput,
  ) {
    try {
      return await this.products.update(id, input);
    } catch (error) {
      if (error instanceof CatalogGraphVersionRequiredError) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: error.message,
          code: error.code,
        });
      }
      if (error instanceof CatalogGraphVersionMismatchError) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: error.message,
          code: error.code,
          expectedVersion: error.expectedVersion,
          actualVersion: error.actualVersion,
        });
      }
      throw error;
    }
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }
}
