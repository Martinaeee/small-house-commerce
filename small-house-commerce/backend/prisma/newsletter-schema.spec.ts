import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';

const database = process.env.NEWSLETTER_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/small_house_variant_test'
  ) {
    throw new Error(
      'Newsletter schema tests require the dedicated local variant test database.',
    );
  }
}

describe.skipIf(!database)('newsletter schema invariants', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    await prisma.$connect();
  });

  async function cleanup() {
    await prisma.promoCodeRedemption.deleteMany();
    await prisma.newsletterPromotion.deleteMany();
    await prisma.newsletterSubscriber.deleteMany();
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('rejects a second ACTIVE promotion at the database level', async () => {
    await prisma.newsletterPromotion.create({
      data: {
        code: 'FIRST',
        discountType: 'PERCENT',
        discountValue: 10,
        status: 'ACTIVE',
      },
    });

    await expect(
      prisma.newsletterPromotion.create({
        data: {
          code: 'SECOND',
          discountType: 'PERCENT',
          discountValue: 5,
          status: 'ACTIVE',
        },
      }),
    ).rejects.toThrow();
  });
});
