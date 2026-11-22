import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { AdminObservabilityController } from './admin/observability.controller.js';
import { AlertNotifier } from './alert-notifier.js';
import { AlertService } from './alert.service.js';
import { ApiMetricsInterceptor } from './api-metrics.interceptor.js';
import { ApiMetricsService } from './api-metrics.service.js';
import { ExternalProbeController } from './external-probe.controller.js';
import { ExternalProbeService } from './external-probe.service.js';
import { ObservabilityService } from './observability.service.js';
import { SyntheticProbeService } from './synthetic-probe.service.js';

/**
 * Storefront Health module: availability probes (P1.5), alerts (P2), API
 * diagnostics (P3), RUM (P4) and journey (P5) extend the same contract.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminObservabilityController, ExternalProbeController],
  providers: [
    ObservabilityService,
    SyntheticProbeService,
    ExternalProbeService,
    AlertService,
    AlertNotifier,
    ApiMetricsService,
    { provide: APP_INTERCEPTOR, useClass: ApiMetricsInterceptor },
  ],
})
export class ObservabilityModule {}
