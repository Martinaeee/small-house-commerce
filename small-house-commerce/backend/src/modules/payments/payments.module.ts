import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SunrateClient } from './sunrate.client.js';
import { readSunrateConfig } from './sunrate.config.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import { PaymentsAdminSettingsController } from './admin/payments-admin.controller.js';
import { StorefrontPaymentsMethodsController } from './storefront/payments-methods.controller.js';

/**
 * SUNRATE online payments module (design 2026-11-20). Registered globally
 * so the orders checkout can consult PaymentMethodsService.
 */
@Module({
  controllers: [PaymentsAdminSettingsController, StorefrontPaymentsMethodsController],
  providers: [
    PaymentMethodsService,
    {
      provide: SunrateClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const cfg = readSunrateConfig(config);
        // A half-configured module keeps its client disabled; the config
        // object itself stays available for error reporting shape.
        return new SunrateClient(
          cfg ?? {
            enabled: false,
            env: 'test',
            baseUrl: 'https://test-api.xunhuiacq.com',
            merchantId: '',
            signKey: '',
            publicBaseUrl: '',
          },
        );
      },
    },
  ],
  exports: [PaymentMethodsService, SunrateClient],
})
export class PaymentsModule {}
