// Prisma CLI configuration.
//
// Prisma 7 no longer reads the connection string from the `datasource` block
// in schema.prisma — it comes from here instead. The .env file is also not
// loaded automatically, hence the dotenv import.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
