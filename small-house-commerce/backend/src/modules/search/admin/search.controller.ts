import {
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { JwtAuthGuard, type RequestUser } from '../../auth/jwt-auth.guard.js';
import {
  adminSearchQuerySchema,
  type AdminSearchQuery,
} from '../dto/search.dto.js';
import { SearchService } from '../search.service.js';

@Controller('admin/search')
@UseGuards(JwtAuthGuard)
export class AdminSearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  search(
    @Query(new ZodValidationPipe(adminSearchQuerySchema)) query: AdminSearchQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.searchService.search(user.userId, query);
  }
}
