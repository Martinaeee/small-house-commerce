import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { reconcileStorefrontShellPermission } from "./reconcile-storefront-shell-permission.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});
const prisma = new PrismaClient({ adapter });

reconcileStorefrontShellPermission(prisma)
  .then((result) => {
    console.log(
      `STOREFRONT_SHELL_MANAGE reconciled for ${result.grantedRoleCodes.join(", ") || "no existing roles"} (${result.grantsCreated} grants created).`,
    );
    if (result.missingRoleCodes.length > 0) {
      console.warn(
        `STOREFRONT_SHELL_MANAGE awaits roles: ${result.missingRoleCodes.join(", ")}. Re-run after first-database bootstrap.`,
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
