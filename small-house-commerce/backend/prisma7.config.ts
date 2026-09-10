// Prisma CLI configuration.
//
// Prisma 7 no longer reads the connection string from the `datasource` block
// in schema.prisma — it comes from here instead. The .env file is also not
// loaded automatically, hence the dotenv import.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  // A directory, not a file: Prisma 7 merges every .prisma file in it, so models
  // can be split by domain (schema.prisma holds the generator and datasource).
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    // tsx, not node: the seed imports the generated client by its .js specifier,
    // which only resolves to the .ts sources via a bundler-aware loader.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
