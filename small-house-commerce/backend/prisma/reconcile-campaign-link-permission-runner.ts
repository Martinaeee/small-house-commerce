import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { reconcileCampaignLinkPermission } from "./reconcile-campaign-link-permission.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});
const prisma = new PrismaClient({ adapter });

reconcileCampaignLinkPermission(prisma)
  .then((result) => {
    console.log(
      `CAMPAIGN_LINK_BUILD reconciled for ${result.grantedRoleCodes.join(", ") || "no existing roles"} (${result.grantsCreated} grants created).`,
    );
    if (result.missingRoleCodes.length > 0) {
      console.warn(
        `CAMPAIGN_LINK_BUILD awaits roles: ${result.missingRoleCodes.join(", ")}. Re-run after first-database bootstrap.`,
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
