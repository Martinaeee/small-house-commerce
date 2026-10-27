import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MetaCapiClient } from './meta-capi.client.js';
import { MetaCapiService } from './meta-capi.service.js';
import {
  AdminMetaCapiController,
  StorefrontMetaEventsController,
} from './meta-capi.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [StorefrontMetaEventsController, AdminMetaCapiController],
  providers: [MetaCapiClient, MetaCapiService],
  exports: [MetaCapiService],
})
export class MetaCapiModule {}
