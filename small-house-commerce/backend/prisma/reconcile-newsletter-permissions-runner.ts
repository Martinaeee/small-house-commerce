import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { reconcileNewsletterPermissions } from "./reconcile-newsletter-permissions.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});
const prisma = new PrismaClient({ adapter });

reconcileNewsletterPermissions(prisma)
  .then((result) => {
    console.log(
      `Newsletter permissions reconciled for ${result.grantedRoleCodes.join(", ") || "no existing roles"} (${result.grantsCreated} grants created).`,
    );
    if (result.missingRoleCodes.length > 0) {
      console.warn(
        `Newsletter permissions await roles: ${result.missingRoleCodes.join(", ")}. Re-run after first-database bootstrap.`,
      );
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
