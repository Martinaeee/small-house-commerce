import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { MetaCapiModule } from '../meta-capi/meta-capi.module.js';
import { SunrateClient } from './sunrate.client.js';
import { readSunrateConfig } from './sunrate.config.js';
import { ApplyVerifiedResultService } from './apply-verified-result.service.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import { PaymentCapabilityService } from './payment-capability.service.js';
import { PaymentsService } from './payments.service.js';
import { PaymentsAdminSettingsController } from './admin/payments-admin.controller.js';
import { PaymentsQueryController } from './admin/payments-query.controller.js';
import { PaymentStatusController } from './storefront/payment-status.controller.js';
import { StorefrontPaymentsController } from './storefront/payments.controller.js';
import { StorefrontPaymentsMethodsController } from './storefront/payments-methods.controller.js';
import { SunrateNotifyController } from './sunrate/notify.controller.js';

/**
 * SUNRATE online payments module (design 2026-11-20). The orders module
 * imports it, so the checkout can consult the per-method switches and start
 * the gateway session.
 */
@Module({
  // AuthModule provides the JwtModule the admin guards inject.
  imports: [AuthModule, MetaCapiModule],
  controllers: [
    PaymentsAdminSettingsController,
    PaymentsQueryController,
    PaymentStatusController,
    StorefrontPaymentsController,
    StorefrontPaymentsMethodsController,
    SunrateNotifyController,
  ],
  providers: [
    PaymentMethodsService,
    PaymentCapabilityService,
    PaymentsService,
    ApplyVerifiedResultService,
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
  exports: [PaymentMethodsService, PaymentCapabilityService, PaymentsService, SunrateClient],
})
export class PaymentsModule {}
