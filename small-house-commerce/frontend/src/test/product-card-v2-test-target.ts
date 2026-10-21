import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

export const PRODUCT_CARD_V2_OWNER = "product-card-v2-20261011";

export function assertProductCardV2TestTarget(
  databaseUrl: string | undefined,
  root: string | undefined,
): { databaseUrl: string; root: string } {
  if (!databaseUrl || !root) throw new Error("Explicit product-card V2 test target required");
  const url = new URL(databaseUrl);
  const rootMatch = /^\/private\/tmp\/luwag-product-card-v2-[A-Za-z0-9_-]+$/.exec(root);
  if (
    url.protocol !== "postgresql:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    (url.port || "5432") !== "5432" ||
    url.pathname !== "/small_house_product_card_v2_20261011_test" ||
    (url.searchParams.get("schema") ?? "public") !== "public" ||
    url.searchParams.getAll("schema").length > 1 ||
    [...url.searchParams.keys()].some(key => key !== "schema") ||
    url.hash !== "" ||
    rootMatch?.[0] !== root
  ) throw new Error("Refused product-card V2 test target");
  const directory = lstatSync(root);
  if (!directory.isDirectory() || directory.isSymbolicLink() || realpathSync(root) !== root)
    throw new Error("Product-card V2 root must be a real owned directory");
  const marker = join(root, ".product-card-v2-owner");
  const markerStat = lstatSync(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink() || readFileSync(marker, "utf8") !== PRODUCT_CARD_V2_OWNER)
    throw new Error("Product-card V2 root owner mismatch");
  return { databaseUrl, root };
}
