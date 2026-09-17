import { Controller, Get, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { barangayQuerySchema, type BarangayQuery } from './psgc.dto.js';
import { PsgcService } from './psgc.service.js';

/**
 * Public PSGC static-data endpoints (no auth guard). Province/city data ships
 * in the frontend bundle; the 4.3MB barangay list stays server-side and is
 * filtered by the selected city/municipality name.
 */
@Controller('storefront/psgc')
export class PsgcController {
  constructor(private readonly psgc: PsgcService) {}

  @Get('barangays')
  barangays(@Query(new ZodValidationPipe(barangayQuerySchema)) query: BarangayQuery) {
    return this.psgc.findBarangays(query.city);
  }
}
