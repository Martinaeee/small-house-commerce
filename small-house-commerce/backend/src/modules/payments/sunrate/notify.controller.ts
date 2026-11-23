import { Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ApplyVerifiedResultService } from '../apply-verified-result.service.js';
import { verifySignature } from '../sunrate.signature.js';
import { readSunrateConfig } from '../sunrate.config.js';

/**
 * The fields a notification is allowed to keep. Everything else — the
 * signature, the merchant reserve and anything unknown — is dropped before
 * the event is stored.
 */
const STORED_FIELDS = [
  'transType',
  'orderNum',
  'orderAmount',
  'orderCurrency',
  'merID',
  'respCode',
  'respMsg',
  'transID',
  'gwTime',
  'transTime',
  'paymentBrand',
  'signType',
] as const;

/** The gateway signs strings; anything else cannot have been signed. */
const toStringFields = (body: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!body || typeof body !== 'object') return out;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    }
  }
  return out;
};

const whitelist = (fields: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of STORED_FIELDS) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  return out;
};

/**
 * The SUNRATE payment notification (docs.acq.sunrate.com/v5
 * payment-result-notification). The gateway posts the transaction here and
 * retries until it gets "OK"; anything else is a failure it will try again.
 *
 * The answer is always plain "OK" once the notification has been recorded:
 * a notification we cannot match is still evidence, and retrying it forever
 * would not make it match. A database failure answers an error instead, so
 * the gateway does try again.
 */
@Controller('payments/sunrate')
export class SunrateNotifyController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly apply: ApplyVerifiedResultService,
  ) {}

  @Post('notify')
  async notify(@Req() request: Request, @Res() response: Response): Promise<void> {
    const fields = toStringFields(request.body);
    const cfg = readSunrateConfig(this.config);
    if (!cfg || !verifySignature(fields, cfg.signKey)) {
      // A forged notification never touches a payment.
      response.status(400).type('text/plain').send('BAD SIGNATURE');
      return;
    }

    const merchantOrderNum = fields.orderNum ?? '';
    try {
      // The attempt is looked up in the environment this endpoint runs in: a
      // notification for another environment must not touch its attempt.
      const attempt = await this.prisma.sunratePaymentAttempt.findFirst({
        where: { merchantOrderNum, env: cfg.env },
      });
      if (!attempt) {
        await this.prisma.sunrateNotificationEvent.create({
          data: {
            orderNum: merchantOrderNum,
            attemptId: null,
            signatureValid: true,
            processed: false,
            outcome: 'UNMATCHED',
            payload: whitelist(fields),
          },
        });
        response.status(200).type('text/plain').send('OK');
        return;
      }

      const event = await this.prisma.sunrateNotificationEvent.create({
        data: {
          orderNum: merchantOrderNum,
          attemptId: attempt.id,
          signatureValid: true,
          processed: false,
          outcome: null,
          payload: whitelist(fields),
        },
      });

      const outcome = await this.apply.applyVerifiedResult({
        merchantOrderNum,
        transId: fields.transID ?? '',
        respCode: fields.respCode ?? '',
        amount: fields.orderAmount ?? '',
        currency: fields.orderCurrency ?? '',
        paymentBrand: fields.paymentBrand,
        gwTime: fields.gwTime ?? '',
        merId: fields.merID,
        transType: fields.transType,
        source: 'NOTIFY',
      });

      await this.prisma.sunrateNotificationEvent.update({
        where: { id: event.id },
        data: { processed: true, outcome },
      });
      response.status(200).type('text/plain').send('OK');
    } catch {
      // The gateway retries a notification it could not answer with OK.
      response.status(500).type('text/plain').send('ERROR');
    }
  }
}
