import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ProductSpecs,
  resolveProductDimensions,
} from './ProductSpecs';

describe('ProductSpecs variant dimensions', () => {
  const product = {
    width: 40,
    height: 70,
    depth: 45,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    materials: null,
    features: null,
  };

  it('resolves an SKU override before the product default', () => {
    expect(
      resolveProductDimensions(product, {
        productWidth: 48,
        productHeight: null,
        productDepth: 52,
      }),
    ).toMatchObject({ width: 48, height: 70, depth: 52 });
  });

  it('renders selected variant dimensions and falls back per axis', () => {
    render(
      <ProductSpecs
        product={product}
        variantDimensions={{
          productWidth: 48,
          productHeight: null,
          productDepth: 52,
        }}
        includeFeatures={false}
      />,
    );

    expect(screen.getByText('48 cm')).toBeVisible();
    expect(screen.getByText('70 cm')).toBeVisible();
    expect(screen.getByText('52 cm')).toBeVisible();
    expect(screen.queryByText('40 cm')).not.toBeInTheDocument();
  });
});
