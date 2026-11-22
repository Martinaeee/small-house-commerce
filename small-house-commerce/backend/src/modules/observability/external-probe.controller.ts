import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ExternalProbeService } from './external-probe.service.js';

/**
 * External probe node ingestion (P1.5). Authenticated by HMAC, never by the
 * admin session; the node writes only EXTERNAL evidence.
 */
@Controller('external')
export class ExternalProbeController {
  constructor(private readonly external: ExternalProbeService) {}

  @Post('probes')
  @HttpCode(202)
  ingest(
    @Body() body: unknown,
    @Headers('x-probe-timestamp') timestamp?: string,
    @Headers('x-probe-signature') signature?: string,
  ) {
    return this.external.ingest(body, timestamp, signature);
  }

  @Post('probe-heartbeat')
  @HttpCode(202)
  heartbeat(
    @Body() body: unknown,
    @Headers('x-probe-timestamp') timestamp?: string,
    @Headers('x-probe-signature') signature?: string,
  ) {
    return this.external.heartbeat(body, timestamp, signature);
  }
}
