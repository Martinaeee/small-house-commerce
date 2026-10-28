import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { QianyiClient } from './qianyi.client.js';
import { QianyiSyncService } from './qianyi-sync.service.js';

@Module({
  imports: [AuthModule],
  providers: [QianyiClient, QianyiSyncService],
  exports: [QianyiClient, QianyiSyncService],
})
export class QianyiModule {}
