import { describe, expect, it } from 'vitest';
import { parsePackagingText, PRODUCT_SIZE_AXES } from './parse-packaging-input';

describe('parsePackagingText', () => {
  it.each([
    '120 x 60 x 75 cm; 2 kg',
    'length: 120 cm, width: 60 cm, height: 75 cm; 2 kg',
    'L: 120 cm, W: 60 cm, H: 75 cm; 2 kg',
  ])('uses the same length-width-height axes for packaging and product sizes in %s', (input) => {
    const expected = {
      packageWidth: 120,
      packageDepth: 60,
      packageHeight: 75,
      packageWeight: 2,
    };
    expect(parsePackagingText(input, 'combined').fields).toEqual(expected);
    expect(parsePackagingText(input, 'combined', PRODUCT_SIZE_AXES).fields).toEqual(expected);
  });

  it('parses a dimension triplet and weight in the combined mode', () => {
    expect(parsePackagingText('30 x 20 x 10 cm; 2 kg', 'combined')).toMatchObject({
      fields: {
        packageWidth: 30,
        packageHeight: 10,
        packageDepth: 20,
        packageWeight: 2,
      },
      warnings: [],
    });
  });

  it('maps labelled dimensions and converts supported units', () => {
    const result = parsePackagingText(
      'W: 1 m, H: 20 in, L: 10 in, Weight: 500 g',
      'combined',
    );

    expect(result.fields).toEqual({
      packageWidth: 25.4,
      packageHeight: 50.8,
      packageDepth: 100,
      packageWeight: 0.5,
    });
    expect(result.warnings).toEqual([]);
  });

  it('reports omitted units as assumptions instead of silently hiding them', () => {
    const result = parsePackagingText('30 x 20 x 10', 'dimensions');

    expect(result.fields).toEqual({
      packageWidth: 30,
      packageHeight: 10,
      packageDepth: 20,
    });
    expect(result.assumptions.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it('rejects duplicate or non-positive labels without guessing', () => {
    const result = parsePackagingText(
      'width: 0 cm, width: 30 cm, height: 20 cm',
      'dimensions',
    );

    expect(result.fields).toEqual({ packageHeight: 20 });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it.each([
    ['width: 30 cm, width: 40 cm, height: 20 cm', { packageHeight: 20 }],
    ['30 x 20 x 10 cm; 40 x 25 x 15 cm', {}],
    ['weight: 2 kg; weight: 3 kg', {}],
    ['2 kg; 3 kg', {}],
    ['width: 30 inches; height: 20 cm', { packageHeight: 20 }],
    ['30 x 20 x 10 yards', {}],
    ['30 x 20 x 10 x 5 cm', {}],
    ['width: Infinity cm; height: 20 cm', { packageHeight: 20 }],
    ['weight: 1e309 kg', {}],
  ])('omits ambiguous or invalid candidates in %s', (input, fields) => {
    const result = parsePackagingText(input, 'combined');
    expect(result.fields).toEqual(fields);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.complete).toBe(false);
  });

  it('shares the trailing unit across labelled dimensions', () => {
    expect(parsePackagingText('W: 300, H: 200, L: 100 mm', 'dimensions')).toMatchObject({
      fields: { packageWidth: 10, packageHeight: 20, packageDepth: 30 },
      assumptions: [],
      warnings: [],
      complete: true,
    });
  });

  it('handles weight-only input in weight mode', () => {
    expect(parsePackagingText('500 g', 'weight').fields).toEqual({ packageWeight: 0.5 });
    expect(parsePackagingText('2', 'weight')).toMatchObject({
      fields: { packageWeight: 2 },
      complete: true,
    });
  });

  it('does not mistake net and gross weights for a single package weight', () => {
    const result = parsePackagingText('net weight 2 kg, gross weight 3 kg', 'combined');
    expect(result.fields).toEqual({});
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it.each(['1,200 x 30 x 50 mm', 'width: 1,200 cm', 'weight: 1,2 kg'])('does not partially parse comma-formatted numbers in %s', input => {
    const result = parsePackagingText(input, 'combined');
    expect(result.fields).toEqual({});
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('does not put an explicit net weight into packaging gross weight', () => {
    const result = parsePackagingText('30 x 20 x 10 cm; net weight 2 kg', 'combined');
    expect(result.fields).toEqual({ packageWidth: 30, packageHeight: 10, packageDepth: 20 });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns no candidates for oversized paste input', () => {
    const result = parsePackagingText('30 x 20 x 10 cm;'.repeat(1000), 'combined');
    expect(result.fields).toEqual({});
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('does not produce or overwrite volumetric weight', () => {
    const result = parsePackagingText('30 x 20 x 10 cm; 2 kg', 'combined');

    expect(result).not.toHaveProperty('volumetricWeight');
    expect(result.fields).not.toHaveProperty('volumetricWeight');
  });
});
