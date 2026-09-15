import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CmsModule } from './modules/cms/cms.module.js';
import { CollectionsModule } from './modules/collections/collections.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';
import { configuration } from './config/configuration.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      // Global so any module can inject ConfigService without re-importing.
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      // Runs parseEnv during bootstrap: an invalid environment stops the app.
      load: [configuration],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    CmsModule,
    CustomersModule,
    CartModule,
    InventoryModule,
    OrdersModule,
    CollectionsModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
