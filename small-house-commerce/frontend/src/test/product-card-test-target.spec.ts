import { describe, expect, it } from "vitest";
import { assertProductCardTestTarget } from "./product-card-test-target";

const databaseUrl = "postgresql://postgres:postgres@localhost:5432/small_house_product_card_20261010_test?schema=public";
const root = "/private/tmp/luwag-product-card-ABC_123";

describe("assertProductCardTestTarget", () => {
  it.each([
    [undefined, root],
    ["", root],
    ["not a URL", root],
    [databaseUrl, undefined],
    [databaseUrl, ""],
    [databaseUrl.replace("postgresql:", "postgres:"), root],
    [databaseUrl.replace("small_house_product_card_20261010_test", "small_house_homepage_rehearsal"), root],
    [databaseUrl.replace("small_house_product_card_20261010_test", "small_house_variant_test"), root],
    [databaseUrl.replace("small_house_product_card_20261010_test", "small_house_prod"), root],
    [databaseUrl.replace("localhost", "example.invalid"), root],
    [databaseUrl.replace(":5432", ":5433"), root],
    [databaseUrl.replace("schema=public", "schema=private"), root],
    [databaseUrl + "&schema=private", root],
    [databaseUrl + "&host=example.invalid", root],
    [databaseUrl + "&dbname=small_house_homepage_rehearsal", root],
    [databaseUrl + "&options=-csearch_path%3Dprivate", root],
    [databaseUrl, "/Users/Admin1/project/backend"],
    [databaseUrl, "luwag-product-card-relative"],
    [databaseUrl, root + "/backend"],
    [databaseUrl, root + "/../another-root"],
    [databaseUrl, root + "\n"],
  ])("refuses unsafe database/root pair %s / %s", (url, directory) => {
    expect(() => assertProductCardTestTarget(url, directory)).toThrow();
  });

  it.each([
    databaseUrl,
    databaseUrl.replace("localhost", "127.0.0.1"),
    databaseUrl.replace(":5432", ""),
    databaseUrl.replace("?schema=public", ""),
  ])("returns the explicit owned target unchanged for %s", (url) => {
    expect(assertProductCardTestTarget(url, root)).toEqual({ databaseUrl: url, root });
  });
});
