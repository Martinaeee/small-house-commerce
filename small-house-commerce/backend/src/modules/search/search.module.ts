import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminSearchController } from './admin/search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminSearchController],
  providers: [SearchService],
})
export class SearchModule {}
