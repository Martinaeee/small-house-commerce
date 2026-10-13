import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Specs that own a singleton database row (the site-settings row and the
// single-ACTIVE newsletter promotion index) must not run at the same time as
// each other: one spec's `create()` archives every ACTIVE promotion, so a
// parallel sibling would see its promotion vanish mid-test. Those files run
// in their own project with file parallelism off; everything else stays
// parallel.
const singletonDbSpecs = [
  'prisma/newsletter-schema.spec.ts',
  'src/modules/newsletter/**/*.spec.ts',
  'src/modules/settings/settings.service.spec.ts',
  'src/modules/orders/orders.service.promo.spec.ts',
];

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['**/*.spec.ts'],
          exclude: singletonDbSpecs,
        },
      },
      {
        extends: true,
        test: {
          name: 'singleton-db',
          include: singletonDbSpecs,
          fileParallelism: false,
        },
      },
    ],
  },
});
