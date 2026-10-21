import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_GATEWAY, type EmailGateway } from './email.gateway.js';
import { LogEmailGateway } from './log-email.gateway.js';
import { ResendEmailGateway } from './resend-email.gateway.js';

export function createEmailGateway(config: ConfigService): EmailGateway {
  const apiKey = config.get<string>('email.apiKey');
  if (!apiKey) {
    return new LogEmailGateway(new Logger('EmailGateway'));
  }

  return new ResendEmailGateway(
    apiKey,
    config.getOrThrow<string>('email.from'),
  );
}

@Module({
  providers: [
    {
      provide: EMAIL_GATEWAY,
      inject: [ConfigService],
      useFactory: createEmailGateway,
    },
  ],
  exports: [EMAIL_GATEWAY],
})
export class EmailModule {}
