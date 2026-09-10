import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryService } from './inventory.service.js';
import { AdminInventoryController } from './admin/inventory.controller.js';

/**
 * InventoryService is shared by the orders module (reserve/release within a
 * transaction) and the admin adjustment controller, so it is exported globally.
 * AuthModule is imported for its exported JwtModule, which the admin guard
 * injects.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [AdminInventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
