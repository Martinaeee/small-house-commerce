import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Exposes PrismaService to the whole application.
 *
 * Global so feature modules can inject it without importing this module into
 * every one of them.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
