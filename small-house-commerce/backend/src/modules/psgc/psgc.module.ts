import { Module } from '@nestjs/common';
import { PsgcController } from './psgc.controller.js';
import { PsgcService } from './psgc.service.js';

/** Read-only PSGC geographic data: static JSON files, no DB, no migrations. */
@Module({
  controllers: [PsgcController],
  providers: [PsgcService],
})
export class PsgcModule {}
