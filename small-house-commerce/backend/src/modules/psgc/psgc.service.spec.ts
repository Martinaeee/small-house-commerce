import { describe, expect, it } from 'vitest';
import { PsgcService } from './psgc.service.js';

/**
 * F08: Isabela City (PSGC prefix 0997) is an independent city inside Basilan.
 * Its barangays must be reachable from both address forms and must never leak
 * into the Region II province "Isabela" or the Negros Occidental municipality
 * of the same name.
 */
describe('PsgcService Isabela City resolution', () => {
  const service = new PsgcService();

  it('serves Isabela City barangays for its own province-level choice', () => {
    const result = service.findBarangays('Isabela City', 'Isabela City');
    expect(result.barangays.length).toBeGreaterThan(0);
    expect(result.barangays.every((b) => b.code.startsWith('0997'))).toBe(true);
    expect(result.barangays.map((b) => b.name)).toContain('Aguada');
  });

  it('serves the same barangays under Basilan', () => {
    const viaCity = service.findBarangays('Isabela City', 'Isabela City');
    const viaBasilan = service.findBarangays('Basilan', 'Isabela City');
    expect(viaBasilan.barangays).toEqual(viaCity.barangays);
  });

  it('never binds Isabela City barangays to the Region II province Isabela', () => {
    const wrong = service.findBarangays('Isabela', 'Isabela City');
    expect(wrong.barangays).toEqual([]);
  });

  it('keeps the Negros Occidental municipality Isabela on its own codes', () => {
    const result = service.findBarangays('Negros Occidental', 'Isabela');
    expect(result.barangays.length).toBeGreaterThan(0);
    expect(result.barangays.every((b) => b.code.startsWith('0645'))).toBe(true);
  });
});
