import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';

/**
 * Static PSGC data module — no DB, no migrations (spec §2). The 42k-row
 * barangay snapshot is parsed ONCE at module load (~50ms boot cost) and shared
 * by every request. The relative URL resolves identically from src
 * (src/modules/psgc -> src/assets) and the compiled tree
 * (dist/modules/psgc -> dist/assets); nest-cli.json copies src/assets into
 * dist/assets during `nest build`.
 */
interface PsgcBarangay {
  // Upstream psgc@2.2.0 encodes 12,521 of 42,036 codes as JSON numbers
  // (leading-zero codes are strings). Committed verbatim, so mirror reality.
  code: string | number;
  name: string;
  citymun: string;
}

export interface PsgcBarangayResult {
  code: string | number;
  name: string;
}

let barangays: PsgcBarangay[] | null = null;
let loadError: string | null = null;

try {
  const assetUrl = new URL('../../assets/psgc-barangays.json', import.meta.url);
  barangays = JSON.parse(readFileSync(assetUrl, 'utf8')) as PsgcBarangay[];
} catch (error) {
  loadError = error instanceof Error ? error.message : String(error);
  // Logger is safe to instantiate at import time; the failed deployment must
  // be visible in logs immediately rather than on the first request.
  new Logger('PsgcService').error(
    `Failed to load PSGC barangay asset (src/assets/psgc-barangays.json must be copied into dist/assets by nest build): ${loadError}`,
  );
}

@Injectable()
export class PsgcService {
  private readonly logger = new Logger(PsgcService.name);

  /**
   * Exact match on the trimmed city/municipality name (the client sends the
   * PSGC name it selected). An unknown city resolves to an empty list — 200,
   * never 404, so the client can render its inline "not found" state.
   */
  findBarangays(city: string): { city: string; barangays: PsgcBarangayResult[] } {
    if (!barangays) {
      this.logger.error(
        `PSGC barangay request failed because the dataset did not load: ${loadError ?? 'unknown error'}`,
      );
      throw new InternalServerErrorException('Barangay data is temporarily unavailable.');
    }

    const normalizedCity = city.trim();
    const matches = barangays
      .filter((barangay) => barangay.citymun === normalizedCity)
      .map(({ code, name }) => ({ code, name }));

    return { city: normalizedCity, barangays: matches };
  }
}
