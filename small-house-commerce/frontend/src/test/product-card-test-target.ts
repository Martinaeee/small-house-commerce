export function assertProductCardTestTarget(
  databaseUrl: string | undefined,
  root: string | undefined,
): { databaseUrl: string; root: string } {
  if (!databaseUrl || !root) throw new Error("Explicit product-card test target required");
  const url = new URL(databaseUrl);
  const rootMatch = /^\/private\/tmp\/luwag-product-card-[A-Za-z0-9_-]+$/.exec(root);
  if (
    url.protocol !== "postgresql:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    (url.port || "5432") !== "5432" ||
    url.pathname !== "/small_house_product_card_20261010_test" ||
    (url.searchParams.get("schema") ?? "public") !== "public" ||
    url.searchParams.getAll("schema").length > 1 ||
    [...url.searchParams.keys()].some((key) => key !== "schema") ||
    rootMatch?.[0] !== root
  ) {
    throw new Error("Refused product-card test target");
  }
  return { databaseUrl, root };
}
